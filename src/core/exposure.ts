import Decimal from 'decimal.js'
import type { AssetId, NetExposure, Position } from './position.js'

export type PriceMap = ReadonlyMap<AssetId, Decimal>

/**
 * When each price was true, by asset. The price side's own freshness: a
 * CoinPaprika quote six hours old under a two-second `AS OF` is exactly the
 * stale figure `Position.asOf` exists to prevent, and a notional is only as
 * fresh as the worse of the quantity and the price behind it.
 */
export type QuoteTimes = ReadonlyMap<AssetId, Date>

const ZERO = new Decimal(0)

/**
 * One spelling per asset. Two venues sending `purr` and `PURR` hold one thing,
 * and bucketing by the raw string published two rows that never net — the
 * failure netting exists to prevent.
 *
 * Case only. Every price source matches on the upper-cased ticker already, so
 * this is the spelling the whole pipeline can agree on; anything beyond case is
 * a venue's own naming, which its connector maps to a canonical symbol.
 */
export function canonicalAsset(asset: AssetId): AssetId {
  return asset.toUpperCase()
}

/** Whatever spelling the oracle answered under, found by the venue's spelling. */
function bySymbol<T>(map: ReadonlyMap<AssetId, T>, asset: AssetId): T | undefined {
  const exact = map.get(asset)
  if (exact !== undefined) return exact
  const key = canonicalAsset(asset)
  for (const [held, value] of map) if (canonicalAsset(held) === key) return value
  return undefined
}

export const priceOf = (prices: PriceMap, asset: AssetId): Decimal | undefined =>
  bySymbol(prices, asset)

/**
 * The product in one function: the same asset held spot on one venue, shorted
 * on another and pledged on a third is one number, not three rows.
 */
export function netExposure(
  positions: Position[],
  prices: PriceMap = new Map(),
  quotedAt: QuoteTimes = new Map(),
): NetExposure[] {
  const byAsset = new Map<AssetId, Position[]>()
  for (const position of positions) {
    const key = canonicalAsset(position.asset)
    const bucket = byAsset.get(key)
    if (bucket) bucket.push(position)
    else byAsset.set(key, [position])
  }

  const exposures: NetExposure[] = []
  for (const [asset, contributors] of byAsset) {
    const delta = contributors.reduce((sum, p) => sum.plus(p.delta), ZERO)
    const price = priceOf(prices, asset)
    let asOf = contributors.reduce(
      (oldest, p) => (p.asOf < oldest ? p.asOf : oldest),
      contributors[0]?.asOf ?? new Date(0),
    )
    // Only where there is a notional to date: an unpriced row states a quantity,
    // and the age of a quote it does not carry says nothing about it.
    const quoted = price === undefined ? undefined : bySymbol(quotedAt, asset)
    if (quoted !== undefined && quoted < asOf) asOf = quoted
    exposures.push({
      asset,
      delta,
      notional: price === undefined ? null : delta.times(price),
      contributors,
      asOf,
    })
  }

  // Biggest money first; unpriced assets last, since they cannot be ranked.
  return exposures.sort((a, b) => {
    if (a.notional === null && b.notional === null) return a.asset.localeCompare(b.asset)
    if (a.notional === null) return 1
    if (b.notional === null) return -1
    return b.notional.abs().comparedTo(a.notional.abs()) || a.asset.localeCompare(b.asset)
  })
}

export interface PortfolioValue {
  /**
   * Null when the book holds something but nothing in it could be priced.
   * Summing no prices gives zero, and `$0.00` beside a live book reads as an
   * empty account rather than as a price source that did not answer — the one
   * thing the security page promises a missing price never becomes. An empty
   * book is genuinely worth zero and still says so.
   */
  total: Decimal | null
  /** Assets excluded from `total` for want of a price. A total that quietly
   *  omits them understates exposure, so callers must show this. */
  unpriced: AssetId[]
}

export function portfolioValue(exposures: NetExposure[]): PortfolioValue {
  let total = ZERO
  let priced = 0
  const unpriced: AssetId[] = []
  for (const e of exposures) {
    if (e.notional === null) unpriced.push(e.asset)
    else {
      total = total.plus(e.notional)
      priced++
    }
  }
  return { total: priced === 0 && unpriced.length > 0 ? null : total, unpriced }
}

/**
 * Oldest input across the whole view — the quotes included, because a view is
 * quantities valued at prices and the older of the two is what dates it. Null
 * when there is nothing to report.
 */
export function oldest(positions: Position[], quotedAt: QuoteTimes = new Map()): Date | null {
  let min: Date | null = null
  for (const at of [...positions.map((p) => p.asOf), ...quotedAt.values()]) {
    if (Number.isNaN(at.getTime())) continue
    if (min === null || at < min) min = at
  }
  return min
}
