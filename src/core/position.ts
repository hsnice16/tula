import Decimal from 'decimal.js'

export type VenueId = string
export type AssetId = string

/**
 * Declared here rather than in `src/connectors/chains.ts`, which holds the node
 * and token list for each: a position carries its chain, so the canonical schema
 * has to name them — and importing the connector's copy would put every
 * connector inside the agent layer's reach, which `scripts/guard.sh` refuses.
 */
export type ChainId =
  | 'ethereum'
  | 'arbitrum'
  | 'base'
  | 'polygon'
  | 'optimism'
  | 'avalanche'
  | 'gnosis'
  | 'scroll'
  | 'linea'

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
  /**
   * The ratio a venue liquidates a whole account on, where it does — Hyperliquid's
   * unified account and portfolio margin. Carried on the one balance row the
   * account ranks under.
   */
  ratio?: MarginRatio
  /**
   * The account whose ratio liquidates this position. Such a position is listed
   * under that account in what breaks first rather than ranked by its own price,
   * which lies past the account's trigger.
   */
  liquidatedWith?: string
  /**
   * The venue's own mark when it stated the position, per unit. Measures the
   * distance to `price` only where the price oracle has no price for the asset —
   * a builder-dex market no source quotes — so the distance is two figures from
   * one venue response rather than a valuation.
   */
  mark?: Decimal
  /**
   * The maintenance margin this position holds at `mark`, where the venue's
   * figures state it. What a shock scales to recompute an account ratio.
   */
  maintenance?: Decimal
}

/**
 * Maintenance over what backs it, as the venue names and states it. Liquidatable
 * once it reaches `threshold`.
 */
export interface MarginRatio {
  /** The venue's own name: `Unified Account Ratio`, `Portfolio Margin Ratio`. */
  name: string
  /** Non-finite where maintenance is owed and nothing is left to back it. */
  value: Decimal
  threshold: Decimal
  /** Identifies the account, so rows carrying one ratio rank once. */
  account: string
  /**
   * What a shock moves, per collateral pool, where the venue states each input.
   * Absent where it does not, and `unshockable` says why.
   */
  pools?: readonly RatioPool[]
  unshockable?: string
  /** Portfolio margin's Borrow Cap Used, as the venue states it. */
  borrowCapUsed?: Decimal
  /**
   * The borrow/lend book's health factor, stated beside the ratio and never
   * ranked: below 100% the account cannot borrow more, and that is not a
   * liquidation.
   */
  borrowHealth?: Decimal
  /**
   * What the ratio could not include because it did not load. Present, `value`
   * covers the rest and is a floor: an unread dex only adds maintenance and
   * isolated margin, so the account is at least that close to its trigger.
   */
  unread?: readonly string[]
}

export interface RatioPool {
  /** The id of the balance row this pool is. */
  row: string
  /** That row's balance, marked to market. */
  balance: Decimal
  /** Margin posted to isolated positions out of it, which backs nothing else. */
  isolated: Decimal
  /** Cross maintenance margin drawn on it across every dex. */
  maintenance: Decimal
}

/**
 * Why a venue states part of a holding is not free. `isolated` is margin posted
 * to one isolated position; `wait` is a queue or lockup nothing done at the venue
 * shortens.
 */
export type HoldReason = 'order' | 'margin' | 'isolated' | 'wait'

/**
 * What the venue itself states is not free of a holding. Either reconciled into
 * claims, or unprovable with the reason — never the venue's figure named as an
 * order nobody placed.
 */
export type VenueHold =
  | { readonly claims: readonly { readonly reason: HoldReason; readonly quantity: Decimal }[] }
  | { readonly unprovable: string }

/** A balance inside a venue's automatic borrowing, in the venue's own terms. */
export interface Borrowing {
  borrowed: Decimal
  supplied: Decimal | null
  /** Loan-to-value the venue counts this token at. */
  ltv: Decimal | null
  /** How much of the per-user cap on borrowing this token is used. */
  capUsed: Decimal | null
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
   * A derivative's share of the portfolio's equity at the price its venue marked
   * it: the unrealised PnL the venue states for it, or zero where the venue states
   * that PnL inside a balance row already on the book — Hyperliquid's
   * `accountValue`, or its spot balance under unified account and portfolio margin.
   *
   * Absent where the venue states neither. `portfolioValue` then leaves the
   * position out and names the venue, because its notional in that place
   * would move the same short by a different amount at each venue.
   */
  equity?: Decimal

  /** What the venue states is not free of this holding. Absent where it states nothing. */
  held?: VenueHold

  /** Present on a balance inside a venue's automatic borrowing. */
  borrowing?: Borrowing

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

  /**
   * The venue's own name for what is held, where `asset` says something else —
   * `WETH` under `ETH`, `USD₮0` under `USDT0`, `kPEPE` under `PEPE`. Without it a
   * wallet holding ETH and WETH is two rows no column tells apart, and which one
   * to unwrap is exactly what somebody moving it needs.
   */
  heldAs?: string

  /**
   * The venue's own name for what this row is held in, where one label holds
   * the same asset in more than one: a contract (`BTCUSDT_250926`), a margin
   * book (`BTCUSDT isolated`), a vault, a staking state. A number is never what
   * tells two rows apart — the reader has to know which one to act on.
   */
  product?: string

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

/**
 * Everything a reader tells one row from another by, numbers aside. Two rows
 * sharing it read as one holding listed twice, whatever their quantities say.
 */
export const rowIdentity = (p: Position): string =>
  [p.venue, p.account?.id ?? '', p.product ?? '', p.kind, p.asset, p.heldAs ?? ''].join('\u0000')

export interface NetExposure {
  asset: AssetId
  delta: Decimal
  /** Null when no price is known. Zero would read as "no exposure", which is a lie. */
  notional: Decimal | null
  contributors: Position[]
  /** Oldest `asOf` among contributors — the figure is only as fresh as its worst input. */
  asOf: Date
}
