import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { AssetId } from '../core/position.js'
import type { PriceOracle, Quote } from '../core/prices.js'
import { request } from '../core/http.js'

const TICKERS = 'https://api.coinpaprika.com/v1/tickers'

/** Quoted in USD, so USD is 1 by definition and must never cost a request. */
const UNITY = new Set(['USD', 'USDD'])

export interface Ticker {
  symbol: string
  rank: number
  last_updated?: string
  quotes?: { USD?: { price?: number | null } }
}

type Fetcher = (url: string) => Promise<Response>

/**
 * Symbols are not unique: several coins share one ticker. CoinPaprika publishes
 * a market-cap rank, so the contest is settled explicitly rather than by
 * whatever order the list happens to arrive in. Rank 0 means unranked, which
 * loses to every ranked coin.
 */
export function bestBySymbol(rows: Ticker[]): Map<string, Ticker> {
  const out = new Map<string, Ticker>()
  for (const row of rows) {
    if (row.quotes?.USD?.price === null || row.quotes?.USD?.price === undefined) continue
    const symbol = row.symbol?.toUpperCase()
    if (!symbol) continue
    const held = out.get(symbol)
    if (!held || rankOf(row) < rankOf(held)) out.set(symbol, row)
  }
  return out
}

const rankOf = (row: Ticker): number => (row.rank > 0 ? row.rank : Number.MAX_SAFE_INTEGER)

export class CoinPaprikaOracle implements PriceOracle {
  readonly source = 'coinpaprika'
  private cache: { at: number; rows: Map<string, Ticker> } | null = null

  constructor(
    private readonly fetcher: Fetcher = (url) => request(url),
    private readonly ttlMs = 60_000,
  ) {}

  private async load(): Promise<Map<string, Ticker>> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.rows

    const res = await this.fetcher(TICKERS)
    if (!res.ok) {
      throw new TulaError(
        res.status === 429
          ? 'CoinPaprika rate limit reached. Prices are unavailable; quantities are still correct.'
          : `CoinPaprika returned HTTP ${res.status}. Prices are unavailable; quantities are still correct.`,
      )
    }
    const rows = (await res.json()) as Ticker[]
    if (!Array.isArray(rows)) throw new TulaError('CoinPaprika returned an unexpected response.')

    const best = bestBySymbol(rows)
    this.cache = { at: Date.now(), rows: best }
    return best
  }

  async quote(asset: AssetId): Promise<Quote | null> {
    return (await this.quoteMany([asset])).get(asset) ?? null
  }

  async quoteMany(assets: AssetId[]): Promise<Map<AssetId, Quote>> {
    const out = new Map<AssetId, Quote>()
    const now = new Date()
    for (const asset of assets) if (UNITY.has(asset)) out.set(asset, { price: new Decimal(1), asOf: now })

    const wanted = assets.filter((a) => !UNITY.has(a))
    if (wanted.length === 0) return out

    const rows = await this.load()
    for (const asset of wanted) {
      const row = rows.get(asset.toUpperCase())
      const price = row?.quotes?.USD?.price
      if (price === null || price === undefined) continue
      out.set(asset, {
        price: new Decimal(price),
        // The source's own clock, per coin: a thinly traded coin's last print
        // may be hours old, and receipt time would hide that.
        asOf: row?.last_updated ? new Date(row.last_updated) : new Date(),
      })
    }
    return out
  }
}
