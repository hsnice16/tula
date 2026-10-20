/**
 * The calculators' arithmetic, shared with each page's worked example so the
 * two cannot disagree.
 *
 * Plain numbers rather than the binary's `Decimal`: these answer a planning
 * question to the cent at best, and the site takes no new dependency.
 */

export type Side = 1 | -1

interface Tier {
  /** Position value, in USDC, at which this tier starts. */
  from: number
  maxLeverage: number
}

/** What each calculator opens on, and so its page's worked example: one copy, so the `noscript` note stays true. */
export const OPENING = {
  hyperliquid: { asset: 'BTC', entry: 100_000, notional: 10_000, leverage: 10 },
  aave: { asset: 'WETH', amount: 4, price: 2_500, debt: 6_000 },
  funding: { notional: 10_000, ratePerHour: 0.0000125, days: 30 },
} as const

/** Hyperliquid's maintenance rate: half the initial margin at max leverage. */
export const maintenanceRate = (maxLeverage: number): number => 1 / (2 * maxLeverage)

/** The tier a position of this value sits in. */
export function tierAt<T extends { from: number }>(
  tiers: readonly T[],
  value: number,
): T | undefined {
  return [...tiers].reverse().find((t) => value >= t.from) ?? tiers[0]
}

interface Rate {
  from: number
  rate: number
  deduction: number
}

/**
 * Hyperliquid's maintenance schedule: the deduction carries the lower tiers forward
 * so that maintenance margin is continuous in position value.
 */
function maintenanceSchedule(tiers: readonly Tier[]): Rate[] {
  const out: Rate[] = []
  for (const t of tiers) {
    const rate = maintenanceRate(t.maxLeverage)
    const prev = out.at(-1)
    out.push({
      from: t.from,
      rate,
      deduction: prev ? prev.deduction + t.from * (rate - prev.rate) : 0,
    })
  }
  return out
}

export function maintenanceMargin(tiers: readonly Tier[], value: number): number {
  const t = tierAt(maintenanceSchedule(tiers), value)
  return t ? value * t.rate - t.deduction : 0
}

interface PerpInput {
  side: Side
  /** In coins, positive whichever the side. */
  size: number
  mark: number
  /**
   * What stands behind the position at `mark`: the isolated margin with its
   * unrealised PnL, or the whole cross account's value.
   */
  equity: number
  /** Maintenance held by the account's other cross positions, assumed not to move. */
  otherMaintenance: number
  tiers: readonly Tier[]
}

/**
 * The price at which equity meets maintenance — Hyperliquid's
 * `price − side × margin_available / size / (1 − l × side)`, solved with the
 * tier's deduction left in. The tier is the one at the position's value *at*
 * the liquidation price, as the docs specify, so each tier is solved and the
 * answer is the one that lands inside its own tier. Maintenance is continuous,
 * so one does; the tolerance keeps a root on a boundary from falling between two.
 *
 * `share` scales the requirement: 2/3 is the backstop, where the liquidator
 * vault takes the position over.
 *
 * Null for a long that no fall can liquidate.
 */
export function perpLiquidationPrice(input: PerpInput, share = 1): number | null {
  const { side, size, mark, equity, otherMaintenance } = input
  const schedule = maintenanceSchedule(input.tiers)
  for (const [i, tier] of schedule.entries()) {
    const price =
      (side * size * mark - equity - tier.deduction * share + otherMaintenance * share) /
      (size * (side - tier.rate * share))
    const value = size * price
    const upTo = schedule[i + 1]?.from ?? Number.POSITIVE_INFINITY
    if (price > 0 && value >= tier.from * (1 - 1e-9) && value <= upTo * (1 + 1e-9)) return price
  }
  return null
}

export interface Collateral {
  /** Value in USD at `price`. */
  value: number
  price: number
  /** As a fraction: 0.83, not 83. */
  threshold: number
}

/** Aave v3: Σ collateral × liquidation threshold ÷ debt. Null with no debt, as Aave reports it. */
export function healthFactor(collateral: readonly Collateral[], debt: number): number | null {
  if (debt <= 0) return null
  return collateral.reduce((sum, c) => sum + c.value * c.threshold, 0) / debt
}

/** How far the whole collateral base can fall, as a fraction, before the factor reaches 1. */
export const dropToLiquidation = (hf: number): number => (hf <= 1 ? 0 : 1 - 1 / hf)

/**
 * The price of one collateral asset at which the factor reaches 1, every other
 * asset and the debt held where they are. Null where the rest of the collateral
 * covers the debt on its own, so this one could go to zero.
 */
export function collateralLiquidationPrice(
  collateral: readonly Collateral[],
  index: number,
  debt: number,
): number | null {
  const own = collateral[index]
  if (!own || own.value <= 0 || own.threshold <= 0 || debt <= 0) return null
  const rest = collateral.reduce(
    (sum, c, i) => (i === index ? sum : sum + c.value * c.threshold),
    0,
  )
  const k = (debt - rest) / (own.value * own.threshold)
  return k <= 0 ? null : own.price * k
}

/**
 * Hyperliquid pays its 8-hour rate hourly, an eighth at a time: 0.01% per 8
 * hours of interest, and a cap that holds for every asset.
 */
export const FUNDING = { interestPerHour: 0.0000125, capPerHour: 0.04 } as const

/**
 * Funding over `hours` at one hourly rate held still: paid when positive. A
 * positive rate is paid by longs to shorts, a negative one the other way.
 */
export const fundingPaid = (side: Side, notional: number, ratePerHour: number, hours: number) =>
  side * notional * ratePerHour * hours

/**
 * Aave v3.3's `LiquidationLogic`: half the total debt per liquidation while the
 * factor is above 0.95, all of it at or below — and all of it, too, where the
 * collateral or debt reserve being liquidated is worth under $2,000. That rule
 * is per reserve, so it is stated beside the factor rather than computed.
 */
export const CLOSE_FACTOR_HF_THRESHOLD = 0.95
export const CLOSE_FACTOR_RESERVE_FLOOR = 2_000

/** Above this value, Hyperliquid's first liquidation order is for `share` of the position. */
export const PARTIAL_LIQUIDATION = { from: 100_000, share: 0.2 } as const
