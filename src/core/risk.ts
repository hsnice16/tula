import Decimal from 'decimal.js'
import { netExposure, portfolioValue, type PortfolioValue, type PriceMap } from './exposure.js'
import type { AssetId, NetExposure, Position } from './position.js'

const ZERO = new Decimal(0)
const ONE = new Decimal(1)

export interface LiquidationRisk {
  position: Position
  /**
   * Signed fractional move in the underlying that reaches liquidation:
   * -0.35 means a 35% fall does it, +0.22 means a 22% rise does. Null when the
   * venue gave us nothing to compute it from — which is not the same as safe.
   */
  move: Decimal | null
  /**
   * Already at or past the trigger, so no move is needed to reach it.
   *
   * Carried separately because a zero move cannot say this on its own: it
   * renders as `+0.0%`, which reads as "a 0% rise would do it" and sorts beside
   * the safest rows on screen. This is the one row a reader must not miss.
   */
  liquidatable: boolean
}

/**
 * Aave-style health factor: at HF the collateral may fall by (1 - 1/HF) before
 * the position is liquidatable. HF of 2 survives a 50% drawdown, HF of 1.1 a 9%.
 */
export function moveFromHealthFactor(healthFactor: Decimal): Decimal {
  if (healthFactor.lte(ONE)) return ZERO
  return ONE.div(healthFactor).minus(ONE)
}

export function liquidationRisk(position: Position, prices: PriceMap): LiquidationRisk {
  const params = position.liquidation
  if (!params) return { position, move: null, liquidatable: false }

  if (params.healthFactor !== undefined) {
    return {
      position,
      move: moveFromHealthFactor(params.healthFactor),
      liquidatable: params.healthFactor.lte(ONE),
    }
  }

  const mark = prices.get(position.asset)
  if (params.price !== undefined && mark !== undefined && !mark.isZero()) {
    return {
      position,
      move: params.price.minus(mark).div(mark),
      // Which side of the trigger the mark already sits on, and that depends on
      // the direction: a long liquidates when the price falls to it, a short
      // when it rises to it. Left as a plain `false` here, every perp already
      // past its trigger reported the move as a *rise* of a few percent — the
      // same misreading the health-factor branch is guarded against, on the
      // venue class that liquidates most often.
      liquidatable: position.delta.isNegative()
        ? mark.gte(params.price)
        : mark.lte(params.price),
    }
  }

  return { position, move: null, liquidatable: false }
}

/** Nearest to liquidation first. Unknowns sort last: they cannot be ranked, not "safe". */
export function whatBreaksFirst(positions: Position[], prices: PriceMap): LiquidationRisk[] {
  return positions
    .map((p) => liquidationRisk(p, prices))
    .filter((r) => r.move !== null || r.position.liquidation !== undefined)
    .sort((a, b) => {
      // Already past the trigger sorts first, ahead of the distance comparison.
      // A health factor below 1 clamps its move to zero and would have sorted
      // there anyway; a perp does not — the further past its liquidation price
      // it is, the *larger* the move, so the row nearest to being lost was
      // landing at the bottom of a table whose contract is "nearest first".
      if (a.liquidatable !== b.liquidatable) return a.liquidatable ? -1 : 1
      if (a.move === null && b.move === null) return 0
      if (a.move === null) return 1
      if (b.move === null) return -1
      return a.move.abs().comparedTo(b.move.abs())
    })
}

export interface Shock {
  asset: AssetId
  /** Signed fraction: -0.2 is a 20% fall. */
  pct: Decimal
}

export function shockPrices(prices: PriceMap, shocks: Shock[]): PriceMap {
  const next = new Map(prices)
  for (const { asset, pct } of shocks) {
    const price = prices.get(asset)
    if (price !== undefined) next.set(asset, price.times(ONE.plus(pct)))
  }
  return next
}

function liquidatesUnder(risk: LiquidationRisk, shocks: Shock[]): boolean {
  if (risk.move === null) return false
  const shock = shocks.find((s) => s.asset === risk.position.asset)
  if (!shock) return false
  if (risk.move.isZero()) return true
  return risk.move.isNegative() ? shock.pct.lte(risk.move) : shock.pct.gte(risk.move)
}

export interface Scenario {
  shocks: Shock[]
  before: PortfolioValue
  after: PortfolioValue
  change: Decimal | null
  exposures: NetExposure[]
  liquidated: Position[]
}

export function scenario(positions: Position[], prices: PriceMap, shocks: Shock[]): Scenario {
  const before = portfolioValue(netExposure(positions, prices))
  const shocked = shockPrices(prices, shocks)
  const exposures = netExposure(positions, shocked)
  const after = portfolioValue(exposures)

  return {
    shocks,
    before,
    after,
    change: before.total === null || after.total === null ? null : after.total.minus(before.total),
    exposures,
    liquidated: positions
      .map((p) => liquidationRisk(p, prices))
      .filter((r) => liquidatesUnder(r, shocks))
      .map((r) => r.position),
  }
}

/**
 * Health factor after the collateral moves, assuming the debt is denominated in
 * something the shock does not touch. True for stablecoin borrows, which is the
 * common case; a same-asset borrow needs the full reserve breakdown.
 */
export function healthFactorUnder(healthFactor: Decimal, collateralMove: Decimal): Decimal {
  return healthFactor.times(ONE.plus(collateralMove))
}
