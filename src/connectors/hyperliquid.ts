import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { Position, Venue } from '../core/position.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'
import { request } from '../core/http.js'
import { addressProblem } from './evm.js'

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
  marginSummary?: { accountValue?: string; totalMarginUsed?: string }
  withdrawable?: string
  time?: number
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

    // The venue timestamps its own snapshot, so freshness is the venue's, not ours.
    // The venue's own clock, but never ahead of ours. `freshness` clamps a
    // negative age to `0s`, so a venue running fast would pin every row at
    // "0s ago" while the snapshot behind it quietly aged — a stale figure
    // rendered as live, which is the one thing an age is there to prevent.
    const received = new Date()
    const stamped = perps.time ? new Date(perps.time) : received
    const asOf = stamped > received ? received : stamped
    const positions: Position[] = []

    for (const entry of perps.assetPositions ?? []) {
      const p = entry.position
      if (!p?.coin || !p.szi) continue
      const raw = new Decimal(p.szi)
      if (raw.isZero()) continue
      const { asset, size, scale } = unscale(p.coin, raw)

      const position: Position = {
        id: `hyperliquid:perp:${asset}`,
        venue: HYPERLIQUID.id,
        kind: 'perp',
        asset,
        quantity: size,
        delta: size,
        asOf,
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
      positions.push({
        id: `hyperliquid:spot:${balance.coin}`,
        venue: HYPERLIQUID.id,
        kind: 'spot',
        asset: balance.coin,
        quantity: total,
        delta: total,
        asOf,
      })
    }

    // Perp margin sits in the account rather than in a position. Without it the
    // account's USDC simply vanishes from the portfolio.
    const free = perps.withdrawable ? new Decimal(perps.withdrawable) : new Decimal(0)
    if (!free.isZero()) {
      positions.push({
        id: 'hyperliquid:spot:USDC-margin',
        venue: HYPERLIQUID.id,
        kind: 'spot',
        asset: 'USDC',
        quantity: free,
        delta: free,
        asOf,
      })
    }

    return positions
  },
}
