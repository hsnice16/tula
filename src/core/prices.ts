import Decimal from 'decimal.js'
import type { AssetId } from './position.js'

export interface Quote {
  price: Decimal
  asOf: Date
}

/**
 * The only gate between a price source's JSON and a figure the user reads.
 *
 * A missing price is already handled everywhere as null, but the values either
 * side of it are not: `new Decimal(0)` is an object and therefore truthy, so a
 * zero used to pass every downstream guard and render a real holding as
 * `$0.00` with no unpriced note — the one defect this project names first.
 * `new Decimal(NaN)` does not throw either, and NaN propagates through every
 * sum, so a single poisoned quote turns the whole book into `$NaN`. Null and a
 * non-finite number both mean the same thing here: no price, not a price of
 * nothing.
 *
 * A number, not a string. All four sources send JSON numbers, and coercing a
 * string here would put a price through `Number` — which drops digits
 * `Decimal` was chosen to keep. A source that starts sending strings should
 * lose its prices loudly rather than round them quietly.
 */
export function usablePrice(raw: unknown): Decimal | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  return new Decimal(raw)
}

/**
 * Quoted in USD, so USD is 1 by definition and must never cost a request.
 * Nothing else belongs here. A stablecoin is a priced asset that is *usually*
 * near a dollar, and pinning one would value it at par through the depeg —
 * the moment its holder most needs the real number.
 *
 * Shared by all four sources rather than restated in each: four copies of one
 * policy is four places for a stablecoin to be pinned in, and the wording had
 * already drifted between them.
 */
export const UNITY = new Set(['USD'])

/**
 * The tickers to ask a source for, each pointing back at the spellings the
 * caller used. A source that quotes by symbol has to ask in one case and answer
 * in the caller's, or an asset a venue happens to spell in lower case goes
 * unpriced by that source alone — which is a book that changes value when the
 * price source is switched.
 *
 * Shared for the reason `UNITY` and `usablePrice` are: the two keyed sources
 * had a byte-identical copy each, and the comment above them stated a property
 * of all four, which is not a claim either copy was in a position to keep.
 * `UNITY` is skipped here rather than in each caller — it is quoted by
 * definition, so asking for it is a request that cannot come back better.
 */
export function byTicker(assets: AssetId[]): Map<string, AssetId[]> {
  const asked = new Map<string, AssetId[]>()
  for (const asset of assets) {
    if (UNITY.has(asset)) continue
    const ticker = asset.toUpperCase()
    const spellings = asked.get(ticker)
    if (spellings) spellings.push(asset)
    else asked.set(ticker, [asset])
  }
  return asked
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
