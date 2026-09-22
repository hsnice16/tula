import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import { typed } from '../core/surface.js'
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
 *
 * A pinned coin no page lists is asked for by id, and only once somebody holds
 * it. xDAI is Gnosis's gas token and has no market-cap rank on CoinGecko, so no
 * number of pages reaches it — `TULA_PRICE_PAGES` included.
 *
 * A bridge's token is priced by its own coin, never by the coin it is named
 * after: that price is exactly the claim a depeg breaks. Each id is the coin
 * CoinGecko files that contract under, keyed by the name `assetOn` gives it.
 */
export const PINNED: Readonly<Record<string, string>> = {
  XDAI: 'xdai',
  USDT0: 'usdt0',
  'ARBITRUM:USDC.E': 'usd-coin-ethereum-bridged',
  'POLYGON:USDC.E': 'bridged-usdc-polygon-pos-bridge',
  'OPTIMISM:USDC.E': 'bridged-usd-coin-optimism',
  'AVALANCHE:USDC.E': 'usd-coin-avalanche-bridged-usdc-e',
  'GNOSIS:USDC.E': 'bridged-usdc-gnosis',
  'GNOSIS:USDC': 'gnosis-xdai-bridged-usdc-gnosis',
  'SCROLL:USDC': 'bridged-usd-coin-scroll',
  'BASE:USDBC': 'bridged-usd-coin-base',
  'OPTIMISM:USDT': 'bridged-usdt',
  'GNOSIS:USDT': 'gnosis-xdai-bridged-usdt-gnosis',
  'SCROLL:USDT': 'bridged-tether-scroll',
  'LINEA:USDT': 'bridged-tether-linea',
  'ARBITRUM:DAI': 'makerdao-arbitrum-bridged-dai-arbitrum-one',
  'OPTIMISM:DAI': 'makerdao-optimism-bridged-dai-optimism',
  'BASE:DAI': 'l2-standard-bridged-dai-base',
  'POLYGON:DAI': 'polygon-pos-bridged-dai-polygon-pos',
  'GNOSIS:DAI': 'omnibridge-bridged-dai-gnosis-chain',
  'LINEA:DAI': 'bridged-dai-stablecoin-linea',
  'AVALANCHE:DAI.E': 'avalanche-bridged-dai-avalanche',
  'ARBITRUM:WBTC': 'arbitrum-bridged-wbtc-arbitrum-one',
  'POLYGON:WBTC': 'polygon-bridged-wbtc-polygon-pos',
  'GNOSIS:WBTC': 'gnosis-xdai-bridged-wbtc-gnosis-chain',
  'SCROLL:WBTC': 'bridged-wrapped-bitcoin-scroll',
  'LINEA:WBTC': 'linea-bridged-wbtc-linea',
  'AVALANCHE:WBTC.E': 'avalanche-old-bridged-wbtc-avalanche',
  'POLYGON:WETH': 'polygon-pos-bridged-weth-polygon-pos',
  'GNOSIS:WETH': 'gnosis-xdai-bridged-weth-gnosis-chain',
  'AVALANCHE:WETH.E': 'avalanche-bridged-weth-avalanche',
  'LINEA:WAVAX': 'celer-bridged-wavax-linea',
  'ARBITRUM:WSTETH': 'arbitrum-bridged-wsteth-arbitrum',
  'BASE:WSTETH': 'superbridge-bridged-wsteth-base',
  'POLYGON:WSTETH': 'polygon-bridged-wsteth-polygon',
  'OPTIMISM:WSTETH': 'superbridge-bridged-wsteth-optimism',
  'GNOSIS:WSTETH': 'bridged-wrapped-steth-gnosis',
  'SCROLL:WSTETH': 'bridged-wrapped-lido-staked-ether-scroll',
  'LINEA:WSTETH': 'linea-bridged-wsteth-linea',
  'ARBITRUM:WEETH': 'arbitrum-bridged-wrapped-eeth',
  'OPTIMISM:BUSD': 'binance-peg-busd',
  'AVALANCHE:BUSD': 'binance-peg-busd',
  'GNOSIS:BUSD': 'bridged-busd',
  'LINEA:BUSD': 'binance-usd-linea',
  'LINEA:GNO': 'linea-bridged-gno-linea',
  'LINEA:LDO': 'linea-bridged-ldo-linea',
  'LINEA:LINK': 'linea-bridged-link-linea',
  'LINEA:UNI': 'linea-bridged-uni-linea',
  'LINEA:MATIC': 'wmatic',
  'AVALANCHE:MIM': 'magic-internet-money-avalanche',
  'OPTIMISM:MAI': 'mai-optimism',
  'AVALANCHE:MAI': 'mai-avalanche',
  'GNOSIS:SDAI': 'savings-xdai',
  'SCROLL:SKY': 'skydrome',
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
  symbol?: string
  current_price: number | null
}

type Fetcher = (url: string) => Promise<Response>

/**
 * `asked` maps every id a request covers to that request, so a pinned coin is
 * fetched once per list and a second caller waits on the first rather than
 * reading the cache before the price lands.
 */
interface Cache {
  at: number
  prices: Map<string, Decimal>
  asked: Map<string, Promise<void>>
}

const ANSWERED = Promise.resolve()

export class CoinGeckoOracle implements PriceOracle {
  readonly source = 'coingecko'
  private cache: Cache | null = null

  constructor(
    private readonly fetcher: Fetcher = (url) => request(url),
    private readonly ttlMs = 60_000,
    private readonly pages?: number,
  ) {}

  private async load(): Promise<Cache> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache

    const pageCap = this.pages ?? pageCount(process.env['TULA_PRICE_PAGES'])
    const prices = new Map<string, Decimal>()
    const byId = new Map<string, Decimal>()

    for (let page = 1; page <= pageCap; page++) {
      const url = `${MARKETS}?vs_currency=usd&order=market_cap_desc&per_page=${PER_PAGE}&page=${page}`
      const res = await this.fetcher(url)
      if (!res.ok) {
        throw new TulaError(
          (res.status === 429
            ? 'CoinGecko rate limit reached. Prices are unavailable; quantities are still correct.'
            : `CoinGecko returned HTTP ${res.status}. Prices are unavailable; quantities are still correct.`) +
            `\n  Try ${typed('refresh')} in a moment.`,
        )
      }
      const rows = (await res.json()) as MarketRow[]
      if (!Array.isArray(rows)) throw new TulaError(`CoinGecko returned an unexpected response.\n  Try ${typed('refresh')} in a moment.`)

      for (const row of rows) {
        const price = usablePrice(row.current_price)
        if (!price) continue
        byId.set(row.id, price)
        const symbol = row.symbol?.toUpperCase()
        if (!symbol) continue
        // Market-cap order means the first symbol seen is the largest holder of it.
        if (!prices.has(symbol)) prices.set(symbol, price)
      }
    }

    for (const [symbol, id] of Object.entries(PINNED)) {
      const pinned = byId.get(id)
      if (pinned) prices.set(symbol, pinned)
    }

    this.cache = { at: Date.now(), prices, asked: new Map([...byId.keys()].map((id) => [id, ANSWERED])) }
    return this.cache
  }

  private async reachPinned(cached: Cache, assets: AssetId[]): Promise<void> {
    const wanted = [
      ...new Set(assets.map((asset) => PINNED[asset.toUpperCase()]).filter((id): id is string => id !== undefined)),
    ]
    const ids = wanted.filter((id) => !cached.asked.has(id))
    if (ids.length > 0) {
      // Dropped again if it answered nothing: an id kept here is an id nothing
      // asks for again, so one 429 used to cost those coins the whole TTL.
      const fetched = this.fetchPinned(cached, ids).then((answered) => {
        if (!answered) for (const id of ids) cached.asked.delete(id)
      })
      for (const id of ids) cached.asked.set(id, fetched)
    }
    await Promise.all(wanted.map((id) => cached.asked.get(id)))
  }

  /** False where nothing was priced, so the caller can let the ids be asked again. */
  private async fetchPinned(cached: Cache, ids: string[]): Promise<boolean> {
    // The pages already priced everything else. Failing here — a status, a
    // deadline, a body that is not JSON — would take all of that away over one
    // coin, which is left unpriced and named by the caller.
    let rows: unknown
    try {
      const res = await this.fetcher(`${MARKETS}?vs_currency=usd&ids=${ids.join(',')}`)
      if (!res.ok) return false
      rows = await res.json()
    } catch {
      return false
    }
    if (!Array.isArray(rows)) return false
    for (const row of rows as MarketRow[]) {
      const price = usablePrice(row?.current_price)
      if (!price) continue
      // One coin can stand behind two names: Binance-Peg BUSD is one contract
      // on Optimism and on Avalanche.
      for (const [symbol, id] of Object.entries(PINNED)) if (id === row?.id) cached.prices.set(symbol, price)
    }
    return true
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
    await this.reachPinned(cached, wanted)
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
