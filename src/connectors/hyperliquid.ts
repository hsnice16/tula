import Decimal from 'decimal.js'
import { remote, TulaError } from '../core/errors.js'
import type { Borrowing, HoldReason, MarginRatio, Position, RatioPool, Venue, VenueHold } from '../core/position.js'
import { typed } from '../core/surface.js'
import { PartialRead, refreshScope, type Connector, type ConnectorCredentials, type KeyScope, type Refresh } from './types.js'
import { request, TooSlow } from '../core/http.js'
import { addressProblem } from './evm.js'
import { canonical } from './symbols.js'
import { CHAINS } from './chains.js'

const INFO = 'https://api.hyperliquid.xyz/info'

export const HYPERLIQUID: Venue = { id: 'hyperliquid', kind: 'perp-dex', name: 'Hyperliquid' }

/**
 * Hyperliquid quotes some low-priced perps in thousands — `kPEPE` is 1000 PEPE.
 * Left as-is it would neither price nor net against the same asset held anywhere
 * else, so the multiple is unwound here rather than carried through the engine.
 *
 * A builder-dex market is `dex:ASSET`, and only the part after the colon is read
 * for the multiple: a dex whose name began with `k` would otherwise be a
 * thousandfold size on every market it lists.
 */
export function unscale(coin: string, size: Decimal): { asset: string; size: Decimal; scale: number } {
  const colon = coin.indexOf(':')
  const prefix = colon === -1 ? '' : coin.slice(0, colon + 1)
  const match = /^k([A-Z0-9]+)$/.exec(coin.slice(prefix.length))
  if (!match?.[1]) return { asset: coin, size, scale: 1 }
  // The quoted price is per thousand, so it has to come down by the same factor
  // the size goes up by, or the liquidation distance is out by 1000x.
  return { asset: `${prefix}${match[1]}`, size: size.times(1000), scale: 1000 }
}

interface PerpPosition {
  coin: string
  szi: string
  liquidationPx?: string | null
  positionValue?: string | null
  leverage?: { type: string; value: number } | null
  marginUsed?: string | null
  maxLeverage?: number
}

interface MarginSummary {
  accountValue?: string
  totalRawUsd?: string
  totalMarginUsed?: string
}

interface ClearinghouseState {
  assetPositions?: Array<{ position?: PerpPosition }>
  marginSummary?: MarginSummary
  crossMarginSummary?: MarginSummary
  crossMaintenanceMarginUsed?: string
  withdrawable?: string
  time?: number
}

interface Balance {
  coin: string
  token?: number
  total: string
  hold?: string
  borrowed?: string
  supplied?: string
  ltv?: string
}

type TokenFigures = Array<[number, string]>

interface SpotState {
  balances?: Balance[]
  portfolioMarginEnabled?: boolean
  portfolioMarginRatio?: string
  tokenToPortfolioBorrowRatio?: TokenFigures
  tokenToAvailableAfterMaintenance?: TokenFigures
}

interface SpotMeta {
  tokens?: Array<{ index: number; name: string }>
  universe?: Array<{ name: string; tokens: [number, number] }>
}

interface Order {
  coin: string
  side: string
  limitPx: string
  sz: string
}

interface DelegatorSummary {
  delegated?: string
  undelegated?: string
  totalPendingWithdrawal?: string
}

interface VaultEquity {
  vaultAddress?: string
  equity?: string
  lockedUntilTimestamp?: number
}

interface SubAccount {
  subAccountUser?: string
}

interface BorrowLendState {
  tokenToState?: Array<[number, { borrow?: { value?: string }; supply?: { value?: string } }]>
  healthFactor?: string | null
}

/**
 * Hyperliquid's own identity, and the check every dex's figures are read under:
 *
 *   accountValue = totalRawUsd + Σ sign(szi) × positionValue
 *
 * It holds in every account mode, which is why it is a check on the venue and
 * never the source of a balance: a balance read from the wrong mode passes it too.
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

/**
 * How the account states its balances. `disabled` and `default` are standard —
 * measured identically on every relation in
 * `tasks/field-report/01-capture-every-account-mode.md` — and `dexAbstraction`,
 * which the venue discontinued, is not read.
 */
export type AccountMode = 'standard' | 'unified' | 'portfolio'

const MODES: Readonly<Record<string, AccountMode>> = {
  disabled: 'standard',
  default: 'standard',
  unifiedAccount: 'unified',
  portfolioMargin: 'portfolio',
}

/** Own keys only: indexed, `toString` names a mode and is read as a pooled one. */
const modeOf = (name: string): AccountMode | undefined => (Object.hasOwn(MODES, name) ? MODES[name] : undefined)

/**
 * A builder dex's name is its deployer's choice, and it becomes the venue label
 * on every row that dex holds, on screen and in a tool result. Refused rather
 * than cleaned: a cleaned name can land on another dex's label, or a sub-account's.
 */
export const DEX_NAME = /^[a-z0-9]{1,16}$/

/**
 * A dex is named permissionlessly and its name becomes the `dex:TICKER` scope on
 * every market it lists — the same shape `assetOn` gives a bridged token. A dex
 * called `optimism` would put `optimism:USDT` on the book, which nets into the
 * real bridged row and draws that bridge's price. The chain ids are the only
 * names that collide, so they are the ones refused.
 */
const CHAIN_IDS: ReadonlySet<string> = new Set(CHAINS.map((c) => c.id))

export const usableDexName = (name: string): boolean => DEX_NAME.test(name) && !CHAIN_IDS.has(name)

/**
 * A spot token's name is its deployer's choice too, and `dex:TICKER` is the one
 * shape it must not be able to spell: a token called `optimism:USDT` would net
 * into the bridged row and price as it. Only the separator is taken away, so the
 * holding is still reported under a name the reader can see is not that asset.
 */
export const spotAsset = (coin: string): string => canonical(coin).replaceAll(':', '.')

/** Both ratios' explanation in the app: "When the value is greater than 95%, your portfolio may be liquidated." */
const RATIO_THRESHOLD = new Decimal('0.95')

const NEGATIVE_HOLD =
  'Hyperliquid states a negative hold on this balance, which it does not document, so what is free here is unknown'
const UNRECONCILED =
  'Hyperliquid holds part of this balance that its resting orders and the margin drawn on it do not account for, so what is free here is unknown'
const UNSHOCKABLE =
  'Hyperliquid does not state the borrow offset, caps and borrow oracle price the Portfolio Margin Ratio is computed from'

const ZERO = new Decimal(0)
const d = (value: string | undefined | null): Decimal => new Decimal(value ?? '0')

/** Venue arithmetic is printed to six places; a difference inside that is its printing. */
const agrees = (a: Decimal, b: Decimal): boolean =>
  a.minus(b).abs().lte(Decimal.max('0.00001', b.abs().times('1e-9')))

/** Its own class so the line naming a part that did not load can say `HTTP 502` and no more. */
class HttpStatus extends TulaError {
  constructor(readonly status: number) {
    super(`Hyperliquid returned HTTP ${status}.\n  It may be rate-limiting you, or down. Try /refresh in a moment.`)
  }
}

async function info<T>(body: Record<string, unknown>): Promise<T> {
  const res = await request(INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'tula' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new HttpStatus(res.status)
  return (await res.json()) as T
}

/** What every account on one refresh is read against. */
interface Listing {
  dexes: Array<{ name: string; refused: boolean; collateral: string | null }>
  tokenName: ReadonlyMap<number, string>
  pairs: ReadonlyMap<string, [number, number]>
}

/** An account's own responses, however they were fetched. */
interface Answers {
  address: string
  mode: string
  spot: SpotState
  books: PromiseSettledResult<ClearinghouseState>[]
  orders: Order[]
}

/** Why a part did not load, short enough to sit inside the line that says so; the remedy follows that line. */
const shortReason = (err: unknown): string =>
  err instanceof HttpStatus
    ? `HTTP ${err.status}`
    : err instanceof TooSlow
      ? 'timed out'
      : remote(err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err))

const errorText = (settled: PromiseSettledResult<unknown> | undefined): string =>
  settled?.status === 'rejected' ? shortReason(settled.reason) : 'no answer'

const LISTING = 'hyperliquid:listing'

async function readListing(): Promise<Listing> {
  const [dexList, metas, spotMeta] = await Promise.all([
    info<Array<{ name?: string } | null>>({ type: 'perpDexs' }),
    info<Array<{ collateralToken?: number }>>({ type: 'allPerpMetas' }),
    info<SpotMeta>({ type: 'spotMeta' }),
  ])
  const tokenName = new Map((spotMeta.tokens ?? []).map((t) => [t.index, t.name]))
  // `allPerpMetas` is in `perpDexs` order, whose leading null is the first-party dex.
  return {
    dexes: dexList.map((dex, i) => {
      const token = tokenName.get(metas[i]?.collateralToken ?? -1)
      // A listed dex with no name is refused too: read as `''`, it would be
      // asked for as the first-party book and counted twice.
      const name = dex === null ? '' : String(dex.name ?? '')
      const refused = dex !== null && !(typeof dex.name === 'string' && usableDexName(dex.name))
      return { name, refused, collateral: token ? spotAsset(token) : null }
    }),
    tokenName,
    pairs: new Map((spotMeta.universe ?? []).map((u) => [u.name, u.tokens])),
  }
}

/**
 * What the venue holds of a balance, reconciled against what could hold it: the
 * resting spot orders that trade the token and, where the account pools margin
 * in spot, the margin its dexes draw on it — cross and isolated apart. Anything
 * else is named as unknown, never as an order to cancel.
 */
function holdOf(balance: Balance, orders: Decimal, cross: Decimal, isolated: Decimal): VenueHold {
  const hold = d(balance.hold)
  if (hold.isZero()) return { claims: [] }
  if (hold.isNegative()) return { unprovable: NEGATIVE_HOLD }
  if (!agrees(hold, orders.plus(cross).plus(isolated))) return { unprovable: UNRECONCILED }
  const claims: Array<{ reason: HoldReason; quantity: Decimal }> = [
    { reason: 'margin', quantity: cross },
    { reason: 'isolated', quantity: isolated },
    { reason: 'order', quantity: orders },
  ]
  return { claims }
}

const isolatedMargin = (state: ClearinghouseState): Decimal =>
  (state.assetPositions ?? [])
    .flatMap((a) => (a.position?.leverage?.type === 'isolated' ? [d(a.position.marginUsed)] : []))
    .reduce((sum, m) => sum.plus(m), ZERO)

/**
 * One account — the address a user connected, or one of its sub-accounts — as
 * its mode states it. `label` is the venue label its rows carry.
 */
function readAccount(answers: Answers, listing: Listing, label: string): { positions: Position[]; failures: string[] } {
  const { address, spot, orders } = answers
  const who = label === HYPERLIQUID.id ? '' : `${label.slice(HYPERLIQUID.id.length + 1)}: `

  // A guessed mode is a guessed balance, so a mode this build does not handle
  // shows none at all.
  const mode = modeOf(answers.mode)
  if (mode === undefined) {
    throw new TulaError(
      `Hyperliquid says ${address} is in account mode "${remote(String(answers.mode))}", which this build ` +
        'does not read, so no balance is shown for it.\n' +
        `  tula reads standard, unified account and portfolio margin; ${typed('update')} checks for a build that reads more.`,
    )
  }
  const pooled = mode !== 'standard'
  // The mode against the shape of the account's own figures: on every account
  // sampled, a pooled mode carried `tokenToAvailableAfterMaintenance` and a
  // standard one did not, and `portfolioMarginEnabled` marked portfolio margin
  // exactly. Where they disagree, one of the two is not what it says.
  if (
    pooled !== (spot.tokenToAvailableAfterMaintenance !== undefined) ||
    (mode === 'portfolio') !== (spot.portfolioMarginEnabled === true)
  ) {
    throw new TulaError(
      `Hyperliquid says ${address} is in ${answers.mode} mode, and its balances are stated the way another ` +
        'mode states them, so no balance is shown rather than one placed in the wrong mode.\n' +
        `  Try ${typed('refresh')}; if it persists, the venue has changed how it states accounts.`,
    )
  }

  const failures: string[] = []
  // Each dex left out, as the ratio names it. Under a pooled mode a dex's
  // balance is the spot state's, which did load, so only its positions are out.
  const unread: string[] = []
  const leftOut = pooled ? 'its positions are left out' : 'its positions and balance are left out'
  const read = listing.dexes.flatMap((dex, i) => {
    const book = answers.books[i]
    if (dex.refused) {
      unread.push('a dex whose name is not spelled like one')
      // Quoted short: the name is the deployer's, and this is a line in a notice.
      const shown = remote(dex.name)
      failures.push(
        `${who}a dex listed as "${shown.length > 24 ? `${shown.slice(0, 23)}…` : shown}" was not read, ` +
          'because the name is not spelled like a dex name; any position on it is left out',
      )
      return []
    }
    const named = dex.name ? `the ${remote(dex.name)} dex` : 'the first-party dex'
    const skip = (what: string): [] => {
      unread.push(named)
      failures.push(`${who}${named} ${what}; ${leftOut}`)
      return []
    }
    if (book?.status !== 'fulfilled') return skip(`did not load (${errorText(book)})`)
    if (dex.collateral === null) return skip('names a collateral token the spot listing does not')
    const off = cashLegError(book.value)
    const value = d(book.value.marginSummary?.accountValue)
    if (off !== null && !agrees(value.minus(off), value)) {
      return skip('states an account value its positions do not add up to')
    }
    return [{ name: dex.name, label: dex.name ? `${label}-${dex.name}` : label, collateral: dex.collateral, state: book.value }]
  })

  // The venue's own clock, but never ahead of ours. `freshness` clamps a
  // negative age to `0s`, so a venue running fast would pin every row at
  // "0s ago" while the snapshot behind it quietly aged — a stale figure
  // rendered as live, which is the one thing an age is there to prevent.
  const received = new Date()
  const first = read.find((b) => b.name === '')?.state.time
  const stamped = first ? new Date(first) : received
  const asOf = stamped > received ? received : stamped

  const account = `hyperliquid:${address}`
  const spotRow = (token: string): string => `${label}:spot:${token}`
  const perpsRow = (dexLabel: string, token: string): string => `${dexLabel}:perps:${token}`
  const positions: Position[] = []
  const balances: Balance[] = (spot.balances ?? []).map((b) => ({ ...b, coin: spotAsset(b.coin) }))
  // A pool token the spot state leaves out holds nothing. Without a row, the
  // ratio it carries and the claims of the perps drawing on it land nowhere,
  // and the account ranks on prices past its trigger.
  if (pooled) {
    for (const { collateral } of read) {
      if (!balances.some((b) => b.coin === collateral)) balances.push({ coin: collateral, total: '0' })
    }
  }
  const balanceOf = (token: string) => balances.find((b) => b.coin === token)

  // Every pool the account's cross positions draw on, for the Unified Account
  // Ratio: per collateral token, the maintenance over every dex using it and
  // the isolated margin that backs nothing else.
  const pools = new Map<string, RatioPool>()
  if (mode === 'unified') {
    for (const dex of read) {
      const pool = pools.get(dex.collateral) ?? {
        row: spotRow(dex.collateral),
        balance: d(balanceOf(dex.collateral)?.total),
        isolated: ZERO,
        maintenance: ZERO,
      }
      pools.set(dex.collateral, {
        ...pool,
        isolated: pool.isolated.plus(isolatedMargin(dex.state)),
        maintenance: pool.maintenance.plus(d(dex.state.crossMaintenanceMarginUsed)),
      })
    }
  }
  const drawn = [...pools.values()].filter((p) => !p.maintenance.isZero())
  const poolRatio = (p: RatioPool): Decimal => {
    const backing = p.balance.minus(p.isolated)
    return backing.lte(0) ? new Decimal(Infinity) : p.maintenance.div(backing)
  }

  const hasPositions = read.some((b) => (b.state.assetPositions ?? []).some((a) => a.position && !d(a.position.szi).isZero()))
  const borrows = balances.some((b) => d(b.borrowed).gt(0))

  // With a dex unread the unified ratio covers the rest and is a floor on the
  // account's, so the account still ranks on it rather than on prices past its
  // trigger. The Portfolio Margin Ratio is the venue's own figure for the whole
  // account, whichever dexes loaded here.
  let ratio: MarginRatio | undefined
  let ratioRow: string | undefined
  if (mode === 'unified' && drawn.length > 0) {
    const worst = drawn.reduce((a, b) => (poolRatio(b).gt(poolRatio(a)) ? b : a))
    ratio = {
      name: 'Unified Account Ratio',
      value: poolRatio(worst),
      threshold: RATIO_THRESHOLD,
      account,
      pools: drawn,
      ...(unread.length > 0 ? { unread } : {}),
    }
    ratioRow = worst.row
  }
  if (mode === 'portfolio' && spot.portfolioMarginRatio !== undefined && (hasPositions || borrows)) {
    const cap = (spot.tokenToPortfolioBorrowRatio ?? []).find(([t]) => listing.tokenName.get(t) === 'USDC')?.[1]
    ratio = {
      name: 'Portfolio Margin Ratio',
      value: d(spot.portfolioMarginRatio),
      threshold: RATIO_THRESHOLD,
      account,
      unshockable: UNSHOCKABLE,
      // Stopped at 100% as the app's `z5` stops it: a use of a limit the venue
      // enforces, not a liquidation.
      ...(cap !== undefined ? { borrowCapUsed: Decimal.min(d(cap), 1) } : {}),
    }
  }

  for (const dex of read) {
    // In standard mode each dex keeps its own balance, the venue's "USDC
    // (Perps)" row with the dex named, valued at its account value — balance
    // plus unrealised PnL, which is why no perp below adds PnL of its own. Under
    // a pooled mode the venue calls these states "not meaningful", and the spot
    // state is the balance.
    const value = d(dex.state.marginSummary?.accountValue)
    const hasOwnRow = mode === 'standard' && !value.isZero()
    if (hasOwnRow) {
      // The app hands this row `withdrawable` as its Available Balance. Of what
      // is not withdrawable, the margin posted to isolated positions is named
      // apart: it is released by those positions alone, not by the cross book.
      const isolated = isolatedMargin(dex.state)
      const unavailable = value.minus(d(dex.state.withdrawable))
      positions.push({
        id: perpsRow(dex.label, dex.collateral),
        venue: dex.label,
        kind: 'collateral',
        asset: dex.collateral,
        quantity: value,
        delta: value,
        asOf,
        held: unavailable.lt(isolated)
          ? { unprovable: UNRECONCILED }
          : {
              claims: [
                { reason: 'margin', quantity: unavailable.minus(isolated) },
                { reason: 'isolated', quantity: isolated },
              ],
            },
      })
    }

    for (const entry of dex.state.assetPositions ?? []) {
      const p = entry.position
      if (!p?.coin || !p.szi) continue
      const raw = new Decimal(p.szi)
      if (raw.isZero()) continue
      const { asset, size, scale } = unscale(p.coin, raw)
      const cross = p.leverage?.type !== 'isolated'
      const pool = mode === 'standard' ? (hasOwnRow ? perpsRow(dex.label, dex.collateral) : undefined) : spotRow(dex.collateral)
      const notional = p.positionValue ? new Decimal(p.positionValue) : null
      const liq = p.liquidationPx
      const leverage = p.leverage?.value
      positions.push({
        id: `${dex.label}:perp:${asset}`,
        venue: dex.label,
        kind: 'perp',
        asset,
        quantity: size,
        delta: size,
        // Its PnL is inside the balance it draws on: the dex's account value in
        // standard mode, the spot total — marked to market — under a pooled one.
        equity: ZERO,
        asOf,
        // Cross positions share one pool and liquidate as one event; an
        // isolated one has only the margin posted to it and dies alone, at the
        // price the venue states rather than one derived from the pool.
        ...(cross && pool ? { encumbers: [pool] } : {}),
        liquidation: {
          // Null on a position the venue cannot liquidate yet. Absent is the
          // honest representation; a zero would read as "liquidates now".
          ...(liq !== null && liq !== undefined && liq !== '' ? { price: new Decimal(liq).div(scale) } : {}),
          ...(leverage !== undefined ? { leverage: new Decimal(leverage) } : {}),
          ...(notional ? { mark: notional.div(size.abs()) } : {}),
          ...(cross && notional && p.maxLeverage ? { maintenance: notional.div(2 * p.maxLeverage) } : {}),
          ...(cross && ratio ? { liquidatedWith: account } : {}),
        },
      })
    }
  }

  // Spot rows. Orders reserve the token they sell and the token they pay in.
  const reservedBy = (token: number | undefined): Decimal =>
    orders.reduce((sum, o) => {
      const traded = listing.pairs.get(o.coin)
      if (!traded || token === undefined) return sum
      if (o.side === 'A' && traded[0] === token) return sum.plus(d(o.sz))
      if (o.side === 'B' && traded[1] === token) return sum.plus(d(o.sz).times(d(o.limitPx)))
      return sum
    }, ZERO)
  const collateralRows =
    mode === 'portfolio' && borrows
      ? balances.filter((b) => d(b.ltv).gt(0) && d(b.total).gt(0) && !d(b.borrowed).gt(0)).map((b) => spotRow(b.coin))
      : []

  // A cross perp under a pooled mode points at its token's spot row, and a row
  // left out for being zero reads to `availability` as a claim nobody could
  // read, which unproves every balance under this label.
  const encumbered = new Set(positions.flatMap((p) => p.encumbers ?? []))

  for (const balance of balances) {
    const total = d(balance.total)
    const borrowed = d(balance.borrowed)
    const id = spotRow(balance.coin)
    if (total.isZero() && !borrowed.gt(0) && id !== ratioRow && !encumbered.has(id)) continue
    const pooledHere = pooled ? read.filter((b) => b.collateral === balance.coin) : []
    const isolated = pooledHere.reduce((sum, b) => sum.plus(isolatedMargin(b.state)), ZERO)
    const margin = pooledHere.reduce((sum, b) => sum.plus(d(b.state.marginSummary?.totalMarginUsed)), ZERO)
    const portfolio = mode === 'portfolio'
    const capUsed = (spot.tokenToPortfolioBorrowRatio ?? []).find(([t]) => t === balance.token)?.[1]
    positions.push({
      id,
      venue: label,
      // A negative Net Balance is the borrow net of what the account holds in
      // the token — the row the venue offers Repay on.
      kind: portfolio && total.isNegative() ? 'debt' : collateralRows.includes(id) ? 'collateral' : 'spot',
      asset: balance.coin,
      quantity: total,
      delta: total,
      asOf,
      held: holdOf(balance, reservedBy(balance.token), margin.minus(isolated), isolated),
      ...(portfolio && (balance.ltv !== undefined || balance.borrowed !== undefined || balance.supplied !== undefined)
        ? {
            borrowing: {
              borrowed,
              supplied: balance.supplied === undefined ? null : d(balance.supplied),
              ltv: balance.ltv === undefined ? null : d(balance.ltv),
              capUsed: capUsed === undefined ? null : Decimal.min(d(capUsed), 1),
            } satisfies Borrowing,
          }
        : {}),
      ...(borrowed.gt(0) && collateralRows.length > 0 ? { encumbers: collateralRows } : {}),
    })
  }

  // Under portfolio margin the ratio sits on the USDC row, where the app's panel
  // reads Borrow Cap Used; under unified, on the pool closest to its trigger.
  if (ratio) {
    const target = ratioRow ?? positions.find((p) => p.id === spotRow('USDC'))?.id ?? positions.find((p) => p.kind !== 'perp')?.id
    const row = positions.find((p) => p.id === target)
    if (row) row.liquidation = { ...row.liquidation, ratio }
    else {
      // Nothing to carry it: positions stay ranked on their own prices rather
      // than listed under an account the book does not hold.
      for (const p of positions) {
        if (p.liquidation?.liquidatedWith) {
          const { liquidatedWith: _, ...rest } = p.liquidation
          p.liquidation = rest
        }
      }
    }
  }

  return { positions, failures }
}

export const hyperliquidConnector: Connector = {
  venue: HYPERLIQUID,

  coverage: {
    reads: [
      'the account mode, and the balances as that mode states them',
      'perp positions on the first-party dex and every builder-deployed dex, with the liquidation price and leverage the venue states',
      'what the venue holds of each balance, against the orders and margin — cross and isolated — that hold it',
      'the Unified Account Ratio and Portfolio Margin Ratio an account is liquidated on',
      'portfolio-margin borrowing: net balance, borrowed, supplied, loan-to-value and cap used',
      'the borrow/lend book, reconciled against the spot balances it states, and its health factor',
      'staked HYPE, the staking balance, the unstaking queue and vault equities',
      'every sub-account, as an account of its own',
    ],
    doesNotRead: [
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

  /**
   * An address costs 20 of Hyperliquid's 1,200 info weight a minute per request,
   * 2 for its spot state and each dex's book, and 60 for the three listing
   * requests (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits).
   * The listing is the venue's, so a refresh asks it once for every address and
   * sub-account; it is never held past the refresh, because a held listing reads
   * a dex listed since as one the account holds nothing on.
   */
  async fetchPositions(creds: ConnectorCredentials, refresh: Refresh = refreshScope()): Promise<Position[]> {
    const address = creds['address']?.toLowerCase()
    if (!address) throw new TulaError('Hyperliquid needs a public address.')

    // Areas of the account rather than the account: one that fails is named and
    // the balances and positions still arrive. Settled, so a failure of the
    // account below leaves none of these unhandled.
    const areas = Promise.allSettled([
      info<DelegatorSummary>({ type: 'delegatorSummary', user: address }),
      info<VaultEquity[]>({ type: 'userVaultEquities', user: address }),
      info<BorrowLendState>({ type: 'borrowLendUserState', user: address }),
    ])
    const [mode, spot, listing, orders, subs] = await Promise.all([
      info<string>({ type: 'userAbstraction', user: address }),
      info<SpotState>({ type: 'spotClearinghouseState', user: address }),
      refresh.shared(LISTING, readListing),
      info<Order[]>({ type: 'frontendOpenOrders', user: address }),
      info<SubAccount[] | null>({ type: 'subAccounts', user: address }),
    ])
    const [staking, vaults, book] = await areas
    const { tokenName } = listing

    const booksOf = (user: string) =>
      Promise.allSettled(
        listing.dexes.map((dex) =>
          dex.refused
            ? Promise.resolve<ClearinghouseState>({})
            : info<ClearinghouseState>(dex.name ? { type: 'clearinghouseState', user, dex: dex.name } : { type: 'clearinghouseState', user }),
        ),
      )

    const master = readAccount({ address, mode, spot, books: await booksOf(address), orders }, listing, HYPERLIQUID.id)
    const positions = [...master.positions]
    const failures = [...master.failures]
    const asOf = positions[0]?.asOf ?? new Date()
    const ratioRow = positions.find((p) => p.liquidation?.ratio)

    // The borrow/lend book, against the spot state. Under portfolio margin every
    // captured token in it was a balance the spot state also states as
    // `supplied` or `borrowed` — the same money, supplied automatically, so
    // nothing is added. Its figure is not compared: idle USDC is supplied and
    // withdrawn as the account trades, and two reads a moment apart differed by
    // 0.08% on one capture while HYPE matched exactly. Outside portfolio margin no
    // capture has shown the book holding anything, so what it holds there is a
    // balance no row here states, and it is named rather than guessed at.
    if (book.status === 'rejected') {
      failures.push(`the borrow/lend book did not load (${errorText(book)}); its health factor is not shown`)
    }
    const unmatched = (book.status === 'fulfilled' ? (book.value.tokenToState ?? []) : []).filter(([token, state]) => {
      const borrow = d(state.borrow?.value)
      const supply = d(state.supply?.value)
      if (borrow.isZero() && supply.isZero()) return false
      if (modeOf(mode) !== 'portfolio') return true
      const balance = spot.balances?.find((b) => b.token === token)
      return (!borrow.isZero() && balance?.borrowed === undefined) || (!supply.isZero() && balance?.supplied === undefined)
    })
    for (const [token] of unmatched) {
      failures.push(
        `the borrow/lend book states a ${remote(tokenName.get(token) ?? `token ${token}`)} balance the spot state does not; that balance is left out`,
      )
    }
    if (book.status === 'fulfilled' && book.value.healthFactor && ratioRow?.liquidation?.ratio) {
      ratioRow.liquidation = {
        ...ratioRow.liquidation,
        ratio: { ...ratioRow.liquidation.ratio, borrowHealth: d(book.value.healthFactor) },
      }
    }

    // The staking account is "Staking Balance + Total Staked" in the app, and
    // both leave through the unstaking queue; what is in the queue already waits.
    const hype = (id: string, kind: Position['kind'], quantity: Decimal, held?: VenueHold): Position[] =>
      quantity.isZero()
        ? []
        : [{ id: `hyperliquid:${id}:HYPE`, venue: HYPERLIQUID.id, kind, asset: 'HYPE', quantity, delta: quantity, asOf, ...(held ? { held } : {}) }]
    if (staking.status === 'fulfilled') {
      const summary = staking.value
      positions.push(
        ...hype('staked', 'staked', d(summary.delegated)),
        ...hype('staking-balance', 'staked', d(summary.undelegated)),
        ...hype('unstaking', 'pending', d(summary.totalPendingWithdrawal), {
          claims: [{ reason: 'wait', quantity: d(summary.totalPendingWithdrawal) }],
        }),
      )
    } else {
      failures.push(`staking did not load (${errorText(staking)}); staked HYPE and the unstaking queue are left out`)
    }

    // A vault equity is value the venue states in USD and pays out in USDC, and
    // no exposure: its positions are the vault's, which the depositor does not
    // hold. Locked, all of it waits.
    if (vaults.status === 'rejected') {
      failures.push(`vaults did not load (${errorText(vaults)}); vault equity is left out`)
    }
    const now = Date.now()
    for (const vault of vaults.status === 'fulfilled' ? vaults.value : []) {
      const equity = d(vault.equity)
      if (equity.isZero()) continue
      if (!vault.vaultAddress || addressProblem(vault.vaultAddress) !== null) {
        failures.push('a vault equity came without a valid vault address; it is left out')
        continue
      }
      positions.push({
        id: `hyperliquid:vault:${vault.vaultAddress.toLowerCase()}`,
        venue: HYPERLIQUID.id,
        kind: 'lp',
        asset: 'USDC',
        quantity: equity,
        delta: ZERO,
        asOf,
        held: {
          claims:
            vault.lockedUntilTimestamp !== undefined && vault.lockedUntilTimestamp > now
              ? [{ reason: 'wait', quantity: equity }]
              : [],
        },
      })
    }

    // Each sub-account is an address of its own with a mode of its own, and is
    // read as one. The spot state `subAccounts` carries is not enough to read it
    // by: it leaves out `tokenToAvailableAfterMaintenance`, which the mode check
    // reads. Its orders are not asked for, so a hold on one is unprovable rather
    // than named after orders nobody read.
    for (const [i, sub] of (subs ?? []).entries()) {
      const user = sub.subAccountUser?.toLowerCase()
      const label = `${HYPERLIQUID.id}-sub-${i + 1}`
      // The venue's text, bound for a request body and every message about the
      // account: an address or nothing.
      if (!user || addressProblem(user) !== null) {
        failures.push(`sub-${i + 1} came without a valid address; its balances and positions are left out`)
        continue
      }
      try {
        const [subMode, subSpot, subBooks] = await Promise.all([
          info<string>({ type: 'userAbstraction', user }),
          info<SpotState>({ type: 'spotClearinghouseState', user }),
          booksOf(user),
        ])
        const read = readAccount({ address: user, mode: subMode, spot: subSpot, books: subBooks, orders: [] }, listing, label)
        positions.push(...read.positions)
        failures.push(...read.failures)
      } catch (err) {
        failures.push(`sub-${i + 1} did not load (${shortReason(err)}); its balances and positions are left out`)
      }
    }

    if (failures.length > 0) throw new PartialRead(positions, failures)
    return positions
  },
}
