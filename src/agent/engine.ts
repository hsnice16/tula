import type { Availability } from '../core/availability.js'
import type { Disclosure } from '../core/coverage.js'
import type { NetExposure, Position } from '../core/position.js'
import type { LiquidationRisk, Scenario, Shock, ShockedHealthFactor } from '../core/risk.js'

export interface VenueStatus {
  venue: string
  positions: number
  asOf: Date | null
  status: 'ok' | string
}

/**
 * Everything the agent layer is allowed to see. It is a view of layer 4 and
 * nothing below it: no connector, no credential, no raw venue response. Every
 * number here was computed by deterministic code before the model saw it.
 */
export interface RiskEngine {
  positions(): Position[]
  exposures(): NetExposure[]
  breaks(): LiquidationRisk[]
  scenario(shocks: Shock[]): Scenario
  /**
   * One row per lending market under the same shocks — the factor is the
   * market's, not the leg's. Its own method rather than a field on `Scenario`
   * because it is weighted by the prices and liquidation thresholds of every
   * leg in the market, and prices are layer 3: passing them over this boundary
   * to be combined here is the arithmetic rule 1 forbids. `after` is
   * null where a leg could not be priced, since the market's shares are then
   * unknowable and a share guessed at is the wrong number this replaces.
   */
  shockedHealthFactors(shocks: Shock[]): ShockedHealthFactor[]
  /**
   * How much of each holding can actually be moved, and what is holding the
   * rest. Its own method rather than a field on a position, for the reason
   * `NetExposure` does not carry one: exposure is price sensitivity, and a
   * pledged asset moves with its price exactly as an unpledged one does.
   */
  availability(): Availability[]
  /**
   * What the connected venues were never asked for. A venue that answered is
   * otherwise read as complete, so a book missing half of Aave narrates as a
   * total — the same defect `incomplete` exists to stop one layer up.
   */
  coverage(): Disclosure
  venues(): VenueStatus[]
  freshness(): { oldest: Date | null; loadedAt: Date; failures: string[]; priceError: string | null }
}
