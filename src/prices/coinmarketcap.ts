import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { AssetId } from '../core/position.js'
import type { PriceOracle, Quote } from '../core/prices.js'
import { request } from '../core/http.js'

const QUOTES = 'https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest'

/** Quoted in USD, so USD is 1 by definition and must never cost a request. */
const UNITY = new Set(['USD', 'USDD'])

/** A URL carrying every symbol at once eventually exceeds what the API accepts. */
const CHUNK = 100

interface QuoteRow {
  symbol: string
  quote?: { USD?: { price?: number | null; last_updated?: string } }
}

interface Body {
  data?: Record<string, QuoteRow[]>
  status?: { error_message?: string | null }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/**
 * Symbols are not unique across CoinMarketCap's universe either. It returns an
 * array per symbol ordered by rank, so the first entry is the coin a trader
 * means by that ticker — the same rule CoinGecko's market-cap ordering gives.
 */
export class CoinMarketCapOracle implements PriceOracle {
  readonly source = 'coinmarketcap'

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetcher = (url, init) => request(url, init),
  ) {}

  async quote(asset: AssetId): Promise<Quote | null> {
    return (await this.quoteMany([asset])).get(asset) ?? null
  }

  async quoteMany(assets: AssetId[]): Promise<Map<AssetId, Quote>> {
    const out = new Map<AssetId, Quote>()
    const now = new Date()
    for (const asset of assets) if (UNITY.has(asset)) out.set(asset, { price: new Decimal(1), asOf: now })

    const wanted = [...new Set(assets.filter((a) => !UNITY.has(a)).map((a) => a.toUpperCase()))]
    if (wanted.length === 0) return out

    for (let start = 0; start < wanted.length; start += CHUNK) {
      const chunk = wanted.slice(start, start + CHUNK)
      const res = await this.fetcher(`${QUOTES}?symbol=${chunk.join(',')}&convert=USD`, {
        headers: { 'X-CMC_PRO_API_KEY': this.apiKey, Accept: 'application/json' },
      })
      if (!res.ok) throw failure(res.status)

      const body = (await res.json()) as Body
      for (const [symbol, rows] of Object.entries(body.data ?? {})) {
        // Ranked, so the first entry is the largest coin using this ticker.
        const price = rows[0]?.quote?.USD?.price
        if (price === null || price === undefined) continue
        const stamped = rows[0]?.quote?.USD?.last_updated
        out.set(symbol.toUpperCase(), {
          price: new Decimal(price),
          // The venue's own clock where it gives one: dating a quote later than
          // it was true would overstate its freshness.
          asOf: stamped ? new Date(stamped) : new Date(),
        })
      }
    }
    return out
  }
}

function failure(status: number): TulaError {
  if (status === 401 || status === 403) {
    return new TulaError(
      'CoinMarketCap rejected the API key. Prices are unavailable; quantities are still correct.\n' +
        '  Replace it with:  /coinmarketcap connect\n' +
        '  Keys are at:      https://pro.coinmarketcap.com/account',
    )
  }
  if (status === 429) {
    return new TulaError(
      'CoinMarketCap rate limit reached. Prices are unavailable; quantities are still correct.\n' +
        '  Every plan caps calls per month; the free one caps them soonest.',
    )
  }
  return new TulaError(`CoinMarketCap returned HTTP ${status}. Prices are unavailable; quantities are still correct.`)
}
