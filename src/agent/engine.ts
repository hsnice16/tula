import type { NetExposure, Position } from '../core/position.js'
import type { LiquidationRisk, Scenario, Shock } from '../core/risk.js'

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
  venues(): VenueStatus[]
  freshness(): { oldest: Date | null; loadedAt: Date; failures: string[]; priceError: string | null }
}
