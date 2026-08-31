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

const EMPTY: LoadResult = {
  positions: [],
  failures: [],
  prices: new Map(),
  priceError: null,
  loadedAt: new Date(0),
}

/**
 * Holds one fetch for the length of a shell session so queries are instant.
 * Cached data is never presented as live: every view renders `asOf` from the
 * positions themselves, and `refresh` is explicit.
 */
export class Session {
  private cached: LoadResult = EMPTY
  private hasLoaded = false

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
      try {
        positions.push(...(await connector.fetchPositions(creds)))
      } catch (err) {
        failures.push(`${venueId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const assets = [...new Set(positions.map((p) => p.asset))]
    let prices: PriceMap = new Map()
    let priceError: string | null = null
    if (assets.length > 0) {
      try {
        const quotes = await this.oracle.quoteMany(assets)
        prices = new Map([...quotes].map(([asset, q]) => [asset, q.price] as [AssetId, Decimal]))
      } catch (err) {
        // Prices are a nicety; quantities are the truth. Losing them degrades
        // the view rather than failing it, but it must be said out loud.
        priceError = err instanceof Error ? err.message : String(err)
      }
    }

    this.cached = { positions, failures, prices, priceError, loadedAt: new Date() }
    this.hasLoaded = true
    return this.cached
  }

  exposures() {
    return netExposure(this.cached.positions, this.cached.prices)
  }

  stalest(): Date | null {
    return oldest(this.cached.positions)
  }
}
