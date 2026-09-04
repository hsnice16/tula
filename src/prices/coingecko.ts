import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { AssetId } from '../core/position.js'
import type { PriceOracle, Quote } from '../core/prices.js'
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
const DEFAULT_PAGES = Number(process.env['TULA_PRICE_PAGES'] ?? '2')

/** Quoted in USD, so USD is 1 by definition and must never cost a request. */
const UNITY = new Set(['USD', 'USDD'])

/**
 * Symbols are not unique: several coins share one ticker. The list is fetched in
 * market-cap order and the first match wins, so a ticker resolves to the largest
 * coin using it — the one a trader means. In the top 500 exactly six tickers are
 * contested, and in every case the intended coin is the larger.
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
    private readonly pages = DEFAULT_PAGES,
  ) {}

  private async load(): Promise<Map<string, Decimal>> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.prices

    const prices = new Map<string, Decimal>()
    const byId = new Map<string, Decimal>()

    for (let page = 1; page <= this.pages; page++) {
      const url = `${MARKETS}?vs_currency=usd&order=market_cap_desc&per_page=${PER_PAGE}&page=${page}`
      const res = await this.fetcher(url)
      if (!res.ok) {
        throw new TulaError(
          res.status === 429
            ? 'CoinGecko rate limit reached. Prices are unavailable; every quantity below is still correct.'
            : `CoinGecko returned HTTP ${res.status}. Prices are unavailable; quantities are still correct.`,
        )
      }
      const rows = (await res.json()) as MarketRow[]
      if (!Array.isArray(rows)) throw new TulaError('CoinGecko returned an unexpected response.')

      for (const row of rows) {
        if (row.current_price === null || row.current_price === undefined) continue
        const price = new Decimal(row.current_price)
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
    return prices
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

    const prices = await this.load()
    // Receipt time, not request time: the list carries no per-coin timestamp, and
    // dating a quote earlier than we can prove would overstate its freshness.
    const received = new Date()
    for (const asset of wanted) {
      const price = prices.get(asset.toUpperCase())
      if (price) out.set(asset, { price, asOf: received })
    }
    return out
  }
}
