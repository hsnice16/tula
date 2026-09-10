import Decimal from 'decimal.js'
import {
  canonicalAsset,
  netExposure,
  portfolioValue,
  priceOf,
  type PortfolioValue,
  type PriceMap,
} from './exposure.js'
import type { AssetId, NetExposure, Position, VenueId } from './position.js'

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
 *
 * The move is the whole market's collateral base, not the leg it is shown
 * beside — one health factor covers everything pledged in that market.
 * `collateralMoveUnder` is what turns a shock on one asset into this figure.
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

  const mark = priceOf(prices, position.asset)
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

/**
 * A row this table owes the reader: something the venue can take, whether or
 * not it said how far away that is.
 *
 * A perp qualifies on its kind alone. Its whole risk is the liquidation price,
 * and both shipped perp venues reach a position without one deliberately —
 * Hyperliquid sends `null` and Binance sends `0` — so filtering on the params
 * deleted leveraged rows from the one table that ranks them, and a book of
 * nothing but those answered "nothing here can be liquidated".
 *
 * Collateral and debt are not here on kind: a market with no debt carries no
 * health factor because there is genuinely nothing to call.
 */
function rankable(position: Position): boolean {
  return position.liquidation !== undefined || position.kind === 'perp'
}

/** Nearest to liquidation first. Unknowns sort last: they cannot be ranked, not "safe". */
export function whatBreaksFirst(positions: Position[], prices: PriceMap): LiquidationRisk[] {
  return positions
    .map((p) => liquidationRisk(p, prices))
    .filter((r) => rankable(r.position))
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

/**
 * The range in which a percentage move is still a scenario.
 *
 * Below -100% the arithmetic does not stop at nothing: `shock ETH -150`
 * repriced a book to less than zero. At the ceiling it has stopped being a
 * question — `1e400` reaches `Decimal` as a finite number and reprices a book
 * to a four-hundred-digit figure.
 *
 * Exported so the command layer can refuse the input with a usage error rather
 * than answer it. The engine bounds it too: a wrong number must not depend on
 * every caller having checked first.
 */
export const SHOCK_FLOOR = new Decimal(-1)
export const SHOCK_CEILING = new Decimal(100)

export function usableShock(pct: Decimal): boolean {
  return pct.isFinite() && pct.gte(SHOCK_FLOOR) && pct.lte(SHOCK_CEILING)
}

const shockFor = (shocks: Shock[], asset: AssetId): Shock | undefined =>
  shocks.find((s) => canonicalAsset(s.asset) === canonicalAsset(asset))

export function shockPrices(prices: PriceMap, shocks: Shock[]): PriceMap {
  const next = new Map(prices)
  for (const { asset, pct } of shocks) {
    for (const [held, price] of prices) {
      if (canonicalAsset(held) !== canonicalAsset(asset)) continue
      const shocked = usableShock(pct) ? price.times(ONE.plus(pct)) : null
      // A move that leaves an asset priced at nothing or less has left the
      // range where the answer is a price at all, so the asset goes unpriced
      // and is named as such. `$0.00` beside a real holding reads as an empty
      // account, and past zero it reads as a debt nobody owes.
      if (shocked !== null && shocked.isFinite() && shocked.gt(0)) next.set(held, shocked)
      else next.delete(held)
    }
  }
  return next
}

/**
 * How far a market's whole collateral base moves when part of it is shocked.
 *
 * One health factor covers everything pledged in a market, so a shock on one
 * leg moves it by that leg's share and no further: 10 WETH beside 1 WBTC is 40%
 * of a $100k base, and a 30% fall in WETH is a 12% fall in what secures the
 * debt. Reading the leg's own move as the base's reported a health factor of
 * 1.42 falling to 0.99 and a liquidation, for a market that ends at 1.25.
 *
 * Legs are weighted by value and by the liquidation threshold the venue pledged
 * each one at, read off the leg — Aave secures a debt with the thresholded
 * value, so a leg pledged at 0.83 is a larger share of what can be called than
 * its value alone says. The threshold is per market, not per asset: one symbol
 * carries different ones across Aave's markets, and this groups by market first
 * for that reason.
 *
 * A market where any leg published no threshold is weighted by value alone
 * throughout. Reading a missing one as 1 would claim that leg secures the debt
 * more completely than any real reserve does and inflate its share; falling the
 * whole market back keeps one unit across its legs, and value alone is the
 * approximation this has always shipped.
 *
 * Null for a market holding a leg nobody could price: the shares are then
 * unknowable, and a share guessed at is the wrong number this replaces.
 */
export function collateralMoveUnder(
  positions: Position[],
  prices: PriceMap,
  shocks: Shock[],
): Map<VenueId, Decimal | null> {
  const byMarket = new Map<VenueId, Position[]>()
  for (const p of positions) {
    if (p.kind !== 'collateral' || p.liquidation?.healthFactor === undefined) continue
    const legs = byMarket.get(p.venue)
    if (legs) legs.push(p)
    else byMarket.set(p.venue, [p])
  }

  const moves = new Map<VenueId, Decimal | null>()
  for (const [venue, legs] of byMarket) {
    const exact = legs.every((l) => l.liquidation?.liquidationThreshold !== undefined)
    let base = ZERO
    let moved = ZERO
    let unpriced = false
    for (const leg of legs) {
      const price = priceOf(prices, leg.asset)
      if (price === undefined) {
        unpriced = true
        break
      }
      const threshold = exact ? (leg.liquidation?.liquidationThreshold ?? ONE) : ONE
      const weight = leg.quantity.abs().times(price).times(threshold)
      base = base.plus(weight)
      const shock = shockFor(shocks, leg.asset)
      if (shock && usableShock(shock.pct)) moved = moved.plus(weight.times(shock.pct))
    }
    moves.set(venue, unpriced || base.isZero() ? null : moved.div(base))
  }
  return moves
}

/**
 * What `healthFactorUnder` assumed, where the book says the assumption does not
 * hold: this market has borrowed something the scenario reprices, so `after`
 * has moved one side of a ratio with two.
 *
 * Null is the common case and the one the assumption was written for — a
 * stablecoin borrow nothing here touches — and the reader is told nothing,
 * because a caveat under every figure is a caveat nobody reads.
 */
export interface ShockedDebt {
  /** The borrowed assets this scenario moves, as the venue spells them. */
  assets: AssetId[]
  /**
   * Where the true factor sits relative to `after`, which holds the debt still.
   * A debt worth less is a debt more easily covered, so a fall in what was
   * borrowed raises the true factor and a rise lowers it — and a market that
   * borrows two assets moving opposite ways settles nothing.
   */
  real: 'higher' | 'lower' | 'unknown'
}

export interface ShockedHealthFactor {
  venue: VenueId
  before: Decimal
  /** Null when a leg of that market could not be priced, so its share of the
   *  collateral — and therefore the new factor — is unknown. */
  after: Decimal | null
  /** Null where the shock touches nothing this market borrows. */
  debt: ShockedDebt | null
}

function shockedDebtIn(positions: Position[], venue: VenueId, shocks: Shock[]): ShockedDebt | null {
  const assets: AssetId[] = []
  let up = false
  let down = false
  for (const p of positions) {
    if (p.kind !== 'debt' || p.venue !== venue) continue
    const shock = shockFor(shocks, p.asset)
    if (!shock || !usableShock(shock.pct) || shock.pct.isZero()) continue
    if (!assets.includes(p.asset)) assets.push(p.asset)
    if (shock.pct.isNegative()) down = true
    else up = true
  }
  if (assets.length === 0) return null
  return { assets, real: up && down ? 'unknown' : down ? 'higher' : 'lower' }
}

/** One row per market, not per collateral leg: the factor is the market's. */
export function shockedHealthFactors(
  positions: Position[],
  prices: PriceMap,
  shocks: Shock[],
): ShockedHealthFactor[] {
  const moves = collateralMoveUnder(positions, prices, shocks)
  const rows: ShockedHealthFactor[] = []
  const seen = new Set<VenueId>()
  for (const p of positions) {
    const before = p.liquidation?.healthFactor
    if (p.kind !== 'collateral' || before === undefined || seen.has(p.venue)) continue
    seen.add(p.venue)
    const move = moves.get(p.venue) ?? null
    rows.push({
      venue: p.venue,
      before,
      after: move === null ? null : healthFactorUnder(before, move),
      debt: shockedDebtIn(positions, p.venue, shocks),
    })
  }
  return rows
}

function liquidatesUnder(
  risk: LiquidationRisk,
  shocks: Shock[],
  collateral: Map<VenueId, Decimal | null>,
): boolean {
  // Already past the trigger: it is gone whatever the shock does, and asking
  // whether a further move would reach it is the reassuring wrong answer. The
  // move alone could not say so — an already-liquidatable perp reports it as a
  // rise of a few percent, so a fall said "nothing liquidates".
  if (risk.liquidatable) return true
  if (risk.move === null) return false

  if (risk.position.liquidation?.healthFactor !== undefined) {
    const move = collateral.get(risk.position.venue)
    return move !== null && move !== undefined && move.lte(risk.move)
  }

  const shock = shockFor(shocks, risk.position.asset)
  if (!shock || !usableShock(shock.pct)) return false
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

export function scenario(
  positions: Position[],
  prices: PriceMap,
  shocks: Shock[],
): Scenario {
  const before = portfolioValue(netExposure(positions, prices))
  const shocked = shockPrices(prices, shocks)
  const exposures = netExposure(positions, shocked)
  const after = portfolioValue(exposures)
  const collateral = collateralMoveUnder(positions, prices, shocks)

  return {
    shocks,
    before,
    after,
    change: before.total === null || after.total === null ? null : after.total.minus(before.total),
    exposures,
    liquidated: positions
      .map((p) => liquidationRisk(p, prices))
      .filter((r) => liquidatesUnder(r, shocks, collateral))
      .map((r) => r.position),
  }
}

/**
 * Health factor after the collateral moves, assuming the debt is denominated in
 * something the shock does not touch. True for stablecoin borrows, which is the
 * common case; a same-asset borrow needs the full reserve breakdown.
 *
 * `ShockedDebt` is that assumption checked against the book rather than left in
 * this comment: every caller renders it, because the reader acting on the
 * figure is the one who has to know which of the two cases they are in.
 *
 * `collateralMove` is the whole base's, which is what `collateralMoveUnder`
 * computes. Handing it one asset's move claims that asset is the entire
 * collateral, and every caller was doing exactly that.
 */
export function healthFactorUnder(healthFactor: Decimal, collateralMove: Decimal): Decimal {
  return healthFactor.times(ONE.plus(collateralMove))
}
