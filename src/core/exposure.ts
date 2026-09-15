import Decimal from 'decimal.js'
import type { AssetId, NetExposure, Position, VenueId } from './position.js'

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
   * Equity. Null when the book holds something but nothing in it could be
   * valued. Summing no prices gives zero, and `$0.00` beside a live book reads as
   * an empty account rather than as a price source that did not answer — the one
   * thing the security page promises a missing price never becomes. An empty
   * book is genuinely worth zero and still says so.
   */
  total: Decimal | null
  /** Assets excluded from `total` for want of a price. A total that quietly
   *  omits them understates the book, so callers must show this. */
  unpriced: AssetId[]
  /** Venues holding a derivative they state no equity for, excluded from
   *  `total` for the same reason and shown beside it the same way. */
  unstated: VenueId[]
}

/**
 * What the book is worth: a holding at its price, a debt subtracted, and a
 * derivative at the equity its venue states — never its notional, which stays
 * in `netExposure` where it measures exposure.
 *
 * A perp's notional in the total would mean the same short moved it by a different
 * amount at each venue, depending on whether that connector also emitted the
 * cash leg that cancels it. Every venue and library surveyed keeps balance,
 * equity and positions apart; `tasks/field-report/04-one-headline-total.md`
 * cites them.
 *
 * `base` is the price a derivative's stated equity was true at. A scenario
 * passes today's prices there and shocked ones as `prices`, so a perp moves by
 * `delta × (shocked − today)`, which is its PnL changing, and not by its
 * notional.
 */
export function portfolioValue(
  positions: readonly Position[],
  prices: PriceMap = new Map(),
  base: PriceMap = prices,
): PortfolioValue {
  let total = ZERO
  let valued = 0
  const unpriced = new Set<AssetId>()
  const unstated = new Set<VenueId>()
  for (const p of positions) {
    const price = priceOf(prices, p.asset)
    if (p.kind === 'perp') {
      if (p.equity === undefined) {
        unstated.add(p.venue)
        continue
      }
      const then = priceOf(base, p.asset)
      // Priced today and not after: the move took the asset out of the range
      // where it has a price, so its PnL under the move is unknown rather than
      // unchanged.
      if (then !== undefined && price === undefined) {
        unpriced.add(canonicalAsset(p.asset))
        continue
      }
      const contributes =
        then === undefined || price === undefined ? p.equity : p.equity.plus(p.delta.times(price.minus(then)))
      total = total.plus(contributes)
      // A zero whose PnL lives in a balance row says nothing about the book on
      // its own. Counted as a value, a book whose balances all went unpriced
      // summed to `$0.00` rather than having no total.
      if (!contributes.isZero()) valued++
      continue
    }
    if (price === undefined) {
      unpriced.add(canonicalAsset(p.asset))
      continue
    }
    total = total.plus(p.quantity.times(price))
    valued++
  }
  const missing = unpriced.size > 0 || unstated.size > 0
  return {
    total: valued === 0 && missing ? null : total,
    unpriced: [...unpriced].sort(),
    unstated: [...unstated].sort(),
  }
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
