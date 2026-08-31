import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { AssetId } from '../core/position.js'
import type { PriceOracle, Quote } from '../core/prices.js'
import { request } from '../core/http.js'

const PRICEMULTI = 'https://min-api.cryptocompare.com/data/pricemulti'

const UNITY = new Set(['USD', 'USDD'])
const CHUNK = 60

interface Body {
  Response?: string
  Message?: string
  [symbol: string]: unknown
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export class CryptoCompareOracle implements PriceOracle {
  readonly source = 'cryptocompare'

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
      const res = await this.fetcher(`${PRICEMULTI}?fsyms=${chunk.join(',')}&tsyms=USD`, {
        headers: { authorization: `Apikey ${this.apiKey}`, Accept: 'application/json' },
      })
      if (!res.ok) throw failure(res.status)

      const body = (await res.json()) as Body
      // It answers 200 with an error envelope rather than a status code, so a
      // rejected key looks like an empty price list unless this is checked.
      if (body.Response === 'Error') {
        throw new TulaError(
          `CryptoCompare: ${body.Message ?? 'request rejected'}\n` +
            '  Replace the key with:  /cryptocompare connect\n' +
            '  Keys are at:           https://www.cryptocompare.com/cryptopian/api-keys',
        )
      }

      // Receipt time: pricemulti carries no per-symbol timestamp, and dating a
      // quote earlier than we can prove would overstate its freshness.
      const received = new Date()
      for (const symbol of chunk) {
        const row = body[symbol] as { USD?: number } | undefined
        if (row?.USD === undefined) continue
        out.set(symbol, { price: new Decimal(row.USD), asOf: received })
      }
    }
    return out
  }
}

function failure(status: number): TulaError {
  if (status === 401 || status === 403) {
    return new TulaError(
      'CryptoCompare rejected the API key. Prices are unavailable; quantities are still correct.\n' +
        '  Replace it with:  /cryptocompare connect',
    )
  }
  if (status === 429) {
    return new TulaError('CryptoCompare rate limit reached. Prices are unavailable; quantities are still correct.')
  }
  return new TulaError(`CryptoCompare returned HTTP ${status}. Prices are unavailable; quantities are still correct.`)
}
