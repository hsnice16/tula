import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { Position, Venue } from '../core/position.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'
import { request } from '../core/http.js'
import { addressProblem } from './evm.js'
import { canonical } from './symbols.js'

const INFO = 'https://api.hyperliquid.xyz/info'

export const HYPERLIQUID: Venue = { id: 'hyperliquid', kind: 'perp-dex', name: 'Hyperliquid' }

/**
 * Hyperliquid quotes some low-priced perps in thousands — `kPEPE` is 1000 PEPE.
 * Left as-is it would neither price nor net against the same asset held anywhere
 * else, so the multiple is unwound here rather than carried through the engine.
 */
export function unscale(coin: string, size: Decimal): { asset: string; size: Decimal; scale: number } {
  const match = /^k([A-Z0-9]+)$/.exec(coin)
  if (!match?.[1]) return { asset: coin, size, scale: 1 }
  // The quoted price is per thousand, so it has to come down by the same factor
  // the size goes up by, or the liquidation distance is out by 1000x.
  return { asset: match[1], size: size.times(1000), scale: 1000 }
}

interface PerpPosition {
  coin: string
  szi: string
  liquidationPx?: string | null
  entryPx?: string | null
  positionValue?: string | null
  leverage?: { type: string; value: number } | null
  marginUsed?: string | null
}

interface ClearinghouseState {
  assetPositions?: Array<{ position?: PerpPosition }>
  marginSummary?: {
    accountValue?: string
    totalRawUsd?: string
    totalMarginUsed?: string
  }
  withdrawable?: string
  time?: number
}

/**
 * The one row every cross perp is margined against, named so `availability()`
 * can find it without matching on an asset symbol.
 */
export const MARGIN_ID = 'hyperliquid:margin:USDC'

/**
 * Hyperliquid's own identity, and the only thing that can contradict a belief
 * about `totalRawUsd`:
 *
 *   accountValue = totalRawUsd + Σ sign(szi) × positionValue
 *
 * Asserted against every captured account in `hyperliquid.test.ts`. A fixture
 * that fails it means the venue changed or we read the wrong field, and either
 * way the USDC row below is wrong.
 */
export function cashLegError(state: ClearinghouseState): Decimal | null {
  const summary = state.marginSummary
  if (!summary?.accountValue || summary.totalRawUsd === undefined) return null
  const legs = (state.assetPositions ?? []).reduce((sum, entry) => {
    const p = entry.position
    if (!p?.szi || !p.positionValue) return sum
    const notional = new Decimal(p.positionValue)
    return sum.plus(new Decimal(p.szi).isNegative() ? notional.negated() : notional)
  }, new Decimal(0))
  return new Decimal(summary.accountValue).minus(new Decimal(summary.totalRawUsd).plus(legs))
}

interface SpotState {
  balances?: Array<{ coin: string; total: string }>
}

async function info<T>(body: Record<string, unknown>): Promise<T> {
  const res = await request(INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'tula' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new TulaError(
      `Hyperliquid returned HTTP ${res.status}.\n` +
        '  It may be rate-limiting you, or down. Try /refresh in a moment.',
    )
  }
  return (await res.json()) as T
}

export const hyperliquidConnector: Connector = {
  venue: HYPERLIQUID,

  coverage: {
    reads: [
      'first-party perp positions, with the liquidation price and leverage the venue states',
      'spot balances',
      'the perp account’s cash leg, as margin rather than as a balance',
    ],
    doesNotRead: [
      {
        what: 'staked HYPE and vault deposits',
        why: 'delegatorSummary and userVaultEquities are never called',
        hides: 'value',
        plan: 'tasks/breadth/10-hyperliquid-depth.md',
      },
      {
        what: 'sub-accounts',
        why: 'subAccounts is never called, and each answers under its own address',
        hides: 'value',
        plan: 'tasks/breadth/10-hyperliquid-depth.md',
      },
      {
        what: 'the borrow/lend book',
        why: 'borrowLendUserState is never called, and it carries a health factor of its own',
        hides: 'liquidation',
        plan: 'tasks/breadth/10-hyperliquid-depth.md',
      },
      {
        what: 'perps on the builder-deployed dexes that perpDexs lists',
        why: 'the dex parameter is never sent with clearinghouseState, so only the first-party book answers',
        hides: 'liquidation',
        plan: 'tasks/breadth/10-hyperliquid-depth.md',
      },
      {
        what: 'the margin behind an isolated position, separately from the cross pool',
        why:
          'marginUsed is discarded, so the margin behind an isolated leg is neither ' +
          'carved out of the cross pool nor shown beside it',
        hides: 'liquidation',
        plan: 'tasks/breadth/10-hyperliquid-depth.md',
      },
      {
        what: 'what the venue has reserved against a spot balance, and what reserved it',
        why:
          'the `hold` field on each balance is not read, and reading it is not the whole of ' +
          'it: on a non-USDC balance it is the resting orders, but on USDC it also carries ' +
          'perp margin — measured over 169 accounts it did on two thirds of them, was the ' +
          'whole of it on some, and went negative on a margin borrower. Named as an order ' +
          'hold it would tell somebody to cancel an order that does not exist',
        hides: 'availability',
        plan: 'tasks/breadth/10-hyperliquid-depth.md',
      },
      // Declared here as well as in `wallet.ts`, which names it as an unread
      // chain. The `NOT READ` line is built from connected venues, so somebody
      // who connected Hyperliquid and no address would be told nothing at all
      // — and the spot balances above are exactly the half of a HyperEVM
      // holding that reads as the whole of it.
      {
        what: 'balances on HyperEVM, Hyperliquid’s own EVM chain',
        why:
          'a holding there is two linked balances — the HyperCore spot balance read above and ' +
          'an EVM ERC-20, scaled against each other per token — and only the HyperCore side is ' +
          'read, so a token bridged to HyperEVM leaves the spot row and is not replaced',
        hides: 'value',
        plan: 'tasks/breadth/12-chain-reach.md',
      },
    ],
  },

  fields: [
    {
      name: 'address',
      label: 'Public address',
      secret: false,
      hint: '0x… — an address, never a key. tula can only read it.',
    },
  ],

  help: [
    { label: 'Hyperliquid docs', url: 'https://hyperliquid.gitbook.io/hyperliquid-docs' },
    { label: 'Find your address', url: 'https://app.hyperliquid.xyz/portfolio' },
  ],

  /**
   * Provably read-only: there is no credential at all, only a public address.
   * Nothing is `unknown` here, unlike an exchange key.
   */
  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const address = creds['address'] ?? ''
    const problem = addressProblem(address)
    if (problem) throw new TulaError(problem)
    await info<ClearinghouseState>({ type: 'clearinghouseState', user: address.toLowerCase() })
    return { canRead: true, canTrade: false, canWithdraw: false }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const address = creds['address']?.toLowerCase()
    if (!address) throw new TulaError('Hyperliquid needs a public address.')

    const [perps, spot] = await Promise.all([
      info<ClearinghouseState>({ type: 'clearinghouseState', user: address }),
      info<SpotState>({ type: 'spotClearinghouseState', user: address }),
    ])

    // The venue's own clock, but never ahead of ours. `freshness` clamps a
    // negative age to `0s`, so a venue running fast would pin every row at
    // "0s ago" while the snapshot behind it quietly aged — a stale figure
    // rendered as live, which is the one thing an age is there to prevent.
    const received = new Date()
    const stamped = perps.time ? new Date(perps.time) : received
    const asOf = stamped > received ? received : stamped
    const positions: Position[] = []

    // `totalRawUsd` is not a deposit and not a balance. Hyperliquid states
    // `accountValue = totalRawUsd + Σ sign(szi) × positionValue`, so this is the
    // cash leg of a spot-equivalent decomposition of the perp book — long the
    // coin, short the dollars. Behind a leveraged long it is negative, which
    // read as the account owing tens of thousands of USDC it does not owe.
    //
    // It stays, because it is the account's equity once the legs beside it are
    // counted and the portfolio total is wrong without it. What changes is what
    // it claims to be: `collateral`, margined against by every cross perp
    // below, so the free figure subtracts it rather than offering it as cash.
    // `withdrawable` remains the fallback — an understated figure beats no row.
    const rawUsd = perps.marginSummary?.totalRawUsd ?? perps.withdrawable
    const margin = rawUsd ? new Decimal(rawUsd) : new Decimal(0)
    const margined = !margin.isZero()

    for (const entry of perps.assetPositions ?? []) {
      const p = entry.position
      if (!p?.coin || !p.szi) continue
      const raw = new Decimal(p.szi)
      if (raw.isZero()) continue
      const { asset, size, scale } = unscale(p.coin, raw)

      // Cross positions share one margin pool, so they liquidate as one account
      // event and each points at that row. An isolated position has only the
      // margin posted to it: it dies alone, and pointing it at the shared pool
      // would claim a liquidation relationship it does not have.
      const cross = margined && p.leverage?.type !== 'isolated'

      const position: Position = {
        id: `hyperliquid:perp:${asset}`,
        venue: HYPERLIQUID.id,
        kind: 'perp',
        asset,
        quantity: size,
        delta: size,
        asOf,
        ...(cross ? { encumbers: [MARGIN_ID] } : {}),
      }
      // liquidationPx is null on a position the venue cannot liquidate yet.
      // Absent is the honest representation; a zero would read as "liquidates now".
      const liq = p.liquidationPx
      if (liq !== null && liq !== undefined && liq !== '') {
        const leverage = p.leverage?.value
        positions.push({
          ...position,
          liquidation: {
            price: new Decimal(liq).div(scale),
            ...(leverage !== undefined ? { leverage: new Decimal(leverage) } : {}),
          },
        })
      } else {
        positions.push(position)
      }
    }

    for (const balance of spot.balances ?? []) {
      const total = new Decimal(balance.total)
      if (total.isZero()) continue
      const asset = canonical(balance.coin)
      positions.push({
        id: `hyperliquid:spot:${asset}`,
        venue: HYPERLIQUID.id,
        kind: 'spot',
        asset,
        quantity: total,
        delta: total,
        asOf,
      })
    }

    if (margined) {
      positions.push({
        id: MARGIN_ID,
        venue: HYPERLIQUID.id,
        kind: 'collateral',
        asset: 'USDC',
        quantity: margin,
        delta: margin,
        asOf,
      })
    }

    return positions
  },
}
