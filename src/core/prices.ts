import type Decimal from 'decimal.js'
import type { AssetId } from './position.js'

export interface Quote {
  price: Decimal
  asOf: Date
}

/**
 * One oracle for the whole process. Venues disagree by a few basis points and
 * mixing their quotes makes aggregate exposure silently inconsistent.
 */
export interface PriceOracle {
  readonly source: string
  /** Null rather than a guess: an unknown price must not read as a zero value. */
  quote(asset: AssetId): Promise<Quote | null>
  quoteMany(assets: AssetId[]): Promise<Map<AssetId, Quote>>
}
