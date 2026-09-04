import Decimal from 'decimal.js'
import type { AssetId, NetExposure, Position } from './position.js'

export type PriceMap = ReadonlyMap<AssetId, Decimal>

const ZERO = new Decimal(0)

/**
 * The product in one function: the same asset held spot on one venue, shorted
 * on another and pledged on a third is one number, not three rows.
 */
export function netExposure(positions: Position[], prices: PriceMap = new Map()): NetExposure[] {
  const byAsset = new Map<AssetId, Position[]>()
  for (const position of positions) {
    const bucket = byAsset.get(position.asset)
    if (bucket) bucket.push(position)
    else byAsset.set(position.asset, [position])
  }

  const exposures: NetExposure[] = []
  for (const [asset, contributors] of byAsset) {
    const delta = contributors.reduce((sum, p) => sum.plus(p.delta), ZERO)
    const price = prices.get(asset)
    const asOf = contributors.reduce(
      (oldest, p) => (p.asOf < oldest ? p.asOf : oldest),
      contributors[0]?.asOf ?? new Date(0),
    )
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

/** Oldest input across the whole view. Null when there is nothing to report. */
export function oldest(positions: Position[]): Date | null {
  if (positions.length === 0) return null
  return positions.reduce((min, p) => (p.asOf < min ? p.asOf : min), positions[0]!.asOf)
}
