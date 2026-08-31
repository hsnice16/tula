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
  if (!params) return { position, move: null }

  if (params.healthFactor !== undefined) {
    return { position, move: moveFromHealthFactor(params.healthFactor) }
  }

  const mark = prices.get(position.asset)
  if (params.price !== undefined && mark !== undefined && !mark.isZero()) {
    return { position, move: params.price.minus(mark).div(mark) }
  }

  return { position, move: null }
}

/** Nearest to liquidation first. Unknowns sort last: they cannot be ranked, not "safe". */
export function whatBreaksFirst(positions: Position[], prices: PriceMap): LiquidationRisk[] {
  return positions
    .map((p) => liquidationRisk(p, prices))
    .filter((r) => r.move !== null || r.position.liquidation !== undefined)
    .sort((a, b) => {
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
  change: Decimal
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
    change: after.total.minus(before.total),
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
