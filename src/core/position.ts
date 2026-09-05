import Decimal from 'decimal.js'

export type VenueId = string
export type AssetId = string

export type VenueKind = 'cex' | 'perp-dex' | 'lending' | 'wallet' | 'payments'

export interface Venue {
  id: VenueId
  kind: VenueKind
  name: string
}

/** `pending` is money that is yours but not yet available to move. */
export type PositionKind =
  | 'spot'
  | 'perp'
  | 'collateral'
  | 'debt'
  | 'lp'
  | 'staked'
  | 'pending'

export interface LiquidationParams {
  /** Absent when the venue liquidates on a portfolio basis rather than per position. */
  price?: Decimal
  /** Aave convention: below 1 the position is liquidatable. */
  healthFactor?: Decimal
  leverage?: Decimal
}

export interface Position {
  id: string
  venue: VenueId
  kind: PositionKind
  asset: AssetId

  /** Signed. Debt and shorts are negative so net exposure is a plain sum. */
  quantity: Decimal

  /**
   * Sensitivity to a one-unit move in the asset price, in asset units.
   * Equals `quantity` for spot and perps but diverges for LP and options,
   * so it cannot be derived at aggregation time.
   */
  delta: Decimal

  liquidation?: LiquidationParams

  /** Sibling positions this one is margined against. A debt is meaningless alone. */
  encumbers?: string[]

  /** A stale risk view is worse than none, so freshness travels with the number. */
  asOf: Date
}

export interface NetExposure {
  asset: AssetId
  delta: Decimal
  /** Null when no price is known. Zero would read as "no exposure", which is a lie. */
  notional: Decimal | null
  contributors: Position[]
  /** Oldest `asOf` among contributors — the figure is only as fresh as its worst input. */
  asOf: Date
}
