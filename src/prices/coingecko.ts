import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { AssetId } from '../core/position.js'
import { UNITY, usablePrice, type PriceOracle, type Quote } from '../core/prices.js'
import { request } from '../core/http.js'

const MARKETS = 'https://api.coingecko.com/api/v3/coins/markets'
const PER_PAGE = 250
/**
 * Two pages is the top 500 by market cap. Four would price a long tail of small
 * perp listings, but it trips CoinGecko's rate limit, and losing every price is
 * worse than leaving a few unpriced. TULA_PRICE_PAGES trades the one against the
 * other. It is not a paid-plan switch: nothing here sends a key, so no plan
 * raises the ceiling — a paid CoinGecko key needs its own host and header.
 */
const DEFAULT_PAGES = 2

/**
 * Read per call rather than at import, and refused rather than coerced.
 * `Number('')` is 0 and `Number('two')` is NaN, and either left the page loop
 * with nothing to run: an empty map was cached and every asset came back
 * unpriced with nothing thrown, so no failure reached `priceError` and the book
 * reported "no price for any of N assets" about a list it never fetched.
 */
function pageCount(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PAGES
  const pages = Number(raw)
  if (!Number.isInteger(pages) || pages < 1) {
    throw new TulaError(
      `TULA_PRICE_PAGES is "${raw}", which is not a number of pages, so nothing was priced.\n` +
        `  Set it to a whole number of 1 or more, or unset it for the top ${DEFAULT_PAGES * PER_PAGE}.`,
    )
  }
  return pages
}

/**
 * Symbols are not unique: several coins share one ticker. The list is fetched in
 * market-cap order and the first match wins, so a ticker resolves to the largest
 * coin using it — the one a trader means.
 *
 * These overrides exist for the assets where a wrong price would be most costly,
 * so they never depend on that ordering holding.
 */
const PINNED: Readonly<Record<string, string>> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  SOL: 'solana',
  WBTC: 'wrapped-bitcoin',
  WETH: 'weth',
}

interface MarketRow {
  id: string
  symbol: string
  current_price: number | null
}

type Fetcher = (url: string) => Promise<Response>

export class CoinGeckoOracle implements PriceOracle {
  readonly source = 'coingecko'
  private cache: { at: number; prices: Map<string, Decimal> } | null = null

  constructor(
    private readonly fetcher: Fetcher = (url) => request(url),
    private readonly ttlMs = 60_000,
    private readonly pages?: number,
  ) {}

  private async load(): Promise<{ at: number; prices: Map<string, Decimal> }> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache

    const pageCap = this.pages ?? pageCount(process.env['TULA_PRICE_PAGES'])
    const prices = new Map<string, Decimal>()
    const byId = new Map<string, Decimal>()

    for (let page = 1; page <= pageCap; page++) {
      const url = `${MARKETS}?vs_currency=usd&order=market_cap_desc&per_page=${PER_PAGE}&page=${page}`
      const res = await this.fetcher(url)
      if (!res.ok) {
        throw new TulaError(
          res.status === 429
            ? 'CoinGecko rate limit reached. Prices are unavailable; quantities are still correct.'
            : `CoinGecko returned HTTP ${res.status}. Prices are unavailable; quantities are still correct.`,
        )
      }
      const rows = (await res.json()) as MarketRow[]
      if (!Array.isArray(rows)) throw new TulaError('CoinGecko returned an unexpected response.')

      for (const row of rows) {
        const price = usablePrice(row.current_price)
        if (!price) continue
        byId.set(row.id, price)
        const symbol = row.symbol.toUpperCase()
        // Market-cap order means the first symbol seen is the largest holder of it.
        if (!prices.has(symbol)) prices.set(symbol, price)
      }
    }

    for (const [symbol, id] of Object.entries(PINNED)) {
      const pinned = byId.get(id)
      if (pinned) prices.set(symbol, pinned)
    }

    this.cache = { at: Date.now(), prices }
    return this.cache
  }

  async quote(asset: AssetId): Promise<Quote | null> {
    return (await this.quoteMany([asset])).get(asset) ?? null
  }

  async quoteMany(assets: AssetId[]): Promise<Map<AssetId, Quote>> {
    const out = new Map<AssetId, Quote>()
    const wanted = assets.filter((a) => !UNITY.has(a))
    const asOf = new Date()

    for (const asset of assets) {
      if (UNITY.has(asset)) out.set(asset, { price: new Decimal(1), asOf })
    }
    if (wanted.length === 0) return out

    const cached = await this.load()
    // When the list was received, not when it was read out of the cache. The
    // list carries no per-coin timestamp, so receipt is the earliest time we
    // can prove — and a price held for the full TTL was stamped a minute young.
    const received = new Date(cached.at)
    for (const asset of wanted) {
      const price = cached.prices.get(asset.toUpperCase())
      if (price) out.set(asset, { price, asOf: received })
    }
    return out
  }
}
