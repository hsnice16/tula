import Decimal from 'decimal.js'

export type VenueId = string
export type AssetId = string

/**
 * Declared here rather than in `src/connectors/chains.ts`, which holds the node
 * and token list for each: a position carries its chain, so the canonical schema
 * has to name them — and importing the connector's copy would put every
 * connector inside the agent layer's reach, which `scripts/guard.sh` refuses.
 */
export type ChainId = 'ethereum' | 'arbitrum' | 'base'

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
  /**
   * Fraction, not basis points. Carried on the leg rather than in a map keyed by
   * asset, because one symbol has different thresholds in different Aave markets
   * and a shared map would take whichever was read last. `collateralMoveUnder`
   * reads it to weight each leg's share of what secures the debt; a market where
   * one leg omits it is weighted by value alone throughout.
   */
  liquidationThreshold?: Decimal
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

  /**
   * Which chain this position sits on. Absent for a venue that is not a chain.
   *
   * Its own field because the venue label already carries the *market* on
   * Ethereum — `aave-prime` — so spelling the chain there too leaves `breaks`
   * parsing a string to answer which of the two it is looking at.
   */
  chain?: ChainId

  /**
   * Which stored credential this row came from. Absent when the venue holds one.
   *
   * Its own field rather than a `venue-suffix`, because that convention already
   * means sub-account or market — `kraken-margin`, `aave-prime`. Loading a
   * second meaning onto it leaves `breaks` unable to tell "which market" from
   * "which wallet", and those are different actions. `label` is display-ready
   * and never derived from a secret, so it may cross into a tool result.
   */
  account?: { id: string; label: string }

  /** Sibling positions this one is margined against. A debt is meaningless alone. */
  encumbers?: string[]

  /** A stale risk view is worse than none, so freshness travels with the number. */
  asOf: Date
}

/**
 * A venue may label its rows with sub-accounts — `kraken-margin` beside
 * `kraken`, `aave-prime` beside `aave` — so a venue filter has to accept its
 * own prefixed labels.
 *
 * In the canonical model rather than the command layer because the agent's
 * tools filter by venue too, and the two answering differently is a filtered
 * book that reads as the whole one.
 */
export function belongsToVenue(positionVenue: VenueId, venueId: VenueId): boolean {
  return positionVenue === venueId || positionVenue.startsWith(`${venueId}-`)
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
