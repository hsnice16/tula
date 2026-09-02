import Decimal from 'decimal.js'
import type { Connector } from '../connectors/types.js'
import { netExposure, oldest, type PriceMap } from '../core/exposure.js'
import type { AssetId, Position } from '../core/position.js'
import type { PriceOracle } from '../core/prices.js'
import * as secrets from '../secrets/store.js'

export interface LoadResult {
  positions: Position[]
  /** Venue-level failures. Never empty and ignored: the view is incomplete. */
  failures: string[]
  prices: PriceMap
  priceError: string | null
  loadedAt: Date
}

/** What a load is waiting on. A step, not a sentence: the UI does the phrasing. */
export type LoadStep = { kind: 'venue'; venue: string } | { kind: 'prices'; assets: number }

const EMPTY: LoadResult = {
  positions: [],
  failures: [],
  prices: new Map(),
  priceError: null,
  loadedAt: new Date(0),
}

/**
 * Two strings on this screen are written by somebody else: a venue's error text
 * and an asset symbol. Both are drawn in the tables *and* returned to the model
 * as tool results, so both are bounded here — the one place all seven
 * connectors arrive, rather than seven chances to forget.
 *
 * `SECURITY.md` lists exactly these two. A third has to be added there in the
 * same commit.
 */

/** Long enough to name the problem, too short to carry an argument. */
const MAX_REASON = 200

export function reason(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  const clean = text.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim()
  return clean.length > MAX_REASON ? `${clean.slice(0, MAX_REASON - 1)}…` : clean
}

/** A handful of characters in every real listing. */
const MAX_SYMBOL = 32

export function symbol(raw: string): string {
  const clean = raw.replace(/[\p{Cc}\p{Cf}]+/gu, '').trim()
  return clean.slice(0, MAX_SYMBOL)
}

/**
 * Holds one fetch for the length of a shell session so queries are instant.
 * Cached data is never presented as live: every view renders `asOf` from the
 * positions themselves, and `refresh` is explicit.
 */
export class Session {
  private cached: LoadResult = EMPTY
  private hasLoaded = false

  /**
   * Told what the load is on: venues are read in turn behind a 15s deadline
   * each, and a spinner that cannot name the one it is waiting on is
   * indistinguishable from a hang. One listener — there is one shell, and one
   * fetch at a time.
   */
  onProgress: ((step: LoadStep | null) => void) | null = null

  constructor(
    private readonly connectors: Map<string, Connector>,
    private oracle: PriceOracle,
  ) {}

  get priceSource(): string {
    return this.oracle.source
  }

  /**
   * Swapping the price source invalidates the cache rather than repricing in
   * place: a book half-priced by one oracle and half by another is exactly the
   * silent inconsistency one-oracle-per-process exists to prevent.
   */
  async useOracle(oracle: PriceOracle): Promise<LoadResult> {
    this.oracle = oracle
    this.hasLoaded = false
    return this.refresh()
  }

  get current(): LoadResult {
    return this.cached
  }

  get isLoaded(): boolean {
    return this.hasLoaded
  }

  async ensureLoaded(): Promise<LoadResult> {
    if (this.hasLoaded) return this.cached
    return this.refresh()
  }

  async refresh(): Promise<LoadResult> {
    try {
      const positions: Position[] = []
      const failures: string[] = []

      for (const venueId of await secrets.listVenues()) {
        const connector = this.connectors.get(venueId)
        if (!connector) {
          failures.push(
            `${venueId}: not a venue this build knows — remove it with /forget ${venueId}`,
          )
          continue
        }
        const creds = await secrets.get(venueId)
        if (!creds) {
          failures.push(`${venueId}: credentials missing`)
          continue
        }
        this.onProgress?.({ kind: 'venue', venue: venueId })
        try {
          for (const p of await connector.fetchPositions(creds)) {
            const asset = symbol(p.asset)
            positions.push(asset === p.asset ? p : { ...p, asset })
          }
        } catch (err) {
          failures.push(`${venueId}: ${reason(err)}`)
        }
      }

      const assets = [...new Set(positions.map((p) => p.asset))]
      let prices: PriceMap = new Map()
      let priceError: string | null = null
      if (assets.length > 0) {
        this.onProgress?.({ kind: 'prices', assets: assets.length })
        try {
          const quotes = await this.oracle.quoteMany(assets)
          prices = new Map([...quotes].map(([asset, q]) => [asset, q.price] as [AssetId, Decimal]))
        } catch (err) {
          // Prices are a nicety; quantities are the truth. Losing them degrades
          // the view rather than failing it, but it must be said out loud.
          priceError = reason(err)
        }
      }

      this.cached = { positions, failures, prices, priceError, loadedAt: new Date() }
      this.hasLoaded = true
      return this.cached
    } finally {
      // Cleared however the load ends, or a label outlives the work it named.
      this.onProgress?.(null)
    }
  }

  exposures() {
    return netExposure(this.cached.positions, this.cached.prices)
  }

  stalest(): Date | null {
    return oldest(this.cached.positions)
  }
}
