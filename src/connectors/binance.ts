import { createHmac } from 'node:crypto'
import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { Position, Venue } from '../core/position.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'
import { request } from '../core/http.js'

const SPOT = 'https://api.binance.com'
const FUTURES = 'https://fapi.binance.com'

export const BINANCE: Venue = { id: 'binance', kind: 'cex', name: 'Binance' }

export class BinanceApiError extends TulaError {
  /** Binance's own code, where it sent one. Absent for a non-JSON error page. */
  readonly code: number | undefined
  constructor(message: string, code?: number) {
    super(message)
    this.code = code
  }
}

/**
 * The codes Binance answers a key that is not allowed to read futures with.
 * Only these are treated as "spot-only account": anything else is a venue that
 * failed, and a venue that failed has to be named rather than netted to zero.
 */
const NO_PERMISSION = new Set([-2015, -2014, -1002])

/** Query-string HMAC, unlike Kraken's payload digest. */
export function sign(query: string, secret: string): string {
  return createHmac('sha256', secret).update(query).digest('hex')
}

async function signedGet<T>(
  base: string,
  path: string,
  creds: ConnectorCredentials,
  params: Record<string, string> = {},
): Promise<T> {
  const key = creds['apiKey']
  const secret = creds['apiSecret']
  if (!key || !secret) throw new TulaError('Binance credentials must have apiKey and apiSecret.')

  const query = new URLSearchParams({
    ...params,
    timestamp: String(Date.now()),
    recvWindow: '10000',
  }).toString()

  const res = await request(`${base}${path}?${query}&signature=${sign(query, secret)}`, {
    headers: { 'X-MBX-APIKEY': key, 'User-Agent': 'tula' },
  })

  // Parsed defensively: a gateway between here and Binance answers 5xx with an
  // HTML page, and reading that as JSON threw a SyntaxError past every handler
  // that knows what a Binance failure looks like.
  let body: ({ code?: number; msg?: string } & T) | null = null
  try {
    body = (await res.json()) as { code?: number; msg?: string } & T
  } catch {
    body = null
  }
  if (body === null) throw new BinanceApiError(`Binance: HTTP ${res.status}`)
  if (!res.ok || typeof body.code === 'number') {
    throw new BinanceApiError(`Binance: ${body.msg ?? `HTTP ${res.status}`}`, body.code)
  }
  return body
}

interface Restrictions {
  enableReading?: boolean
  enableWithdrawals?: boolean
  enableSpotAndMarginTrading?: boolean
  enableFutures?: boolean
  enableMargin?: boolean
}

interface SpotAccount {
  balances?: Array<{ asset: string; free: string; locked: string }>
}

interface FuturesPosition {
  symbol: string
  positionAmt: string
  liquidationPrice?: string
  leverage?: string
}

export const binanceConnector: Connector = {
  venue: BINANCE,

  fields: [
    { name: 'apiKey', label: 'API key', secret: false, hint: 'Enable Reading only' },
    { name: 'apiSecret', label: 'API secret', secret: true },
  ],

  help: [
    { label: 'Create an API key', url: 'https://www.binance.com/en/support/faq/detail/360002502072' },
    { label: 'API key restrictions', url: 'https://www.binance.com/en/support/faq/detail/360016547311' },
    { label: 'API documentation', url: 'https://developers.binance.com/docs/binance-spot-api-docs' },
  ],

  /**
   * Binance reports permissions directly, so every field here is proven —
   * nothing is `unknown`, unlike Kraken. That difference is worth showing.
   */
  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const r = await signedGet<Restrictions>(SPOT, '/sapi/v1/account/apiRestrictions', creds)
    return {
      canRead: r.enableReading === true,
      canTrade: r.enableSpotAndMarginTrading === true || r.enableFutures === true,
      canWithdraw: r.enableWithdrawals === true,
    }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const spot = await signedGet<SpotAccount>(SPOT, '/api/v3/account', creds)
    const asOf = new Date()
    const positions: Position[] = []

    for (const balance of spot.balances ?? []) {
      const total = new Decimal(balance.free).plus(balance.locked)
      if (total.isZero()) continue
      positions.push({
        id: `binance:spot:${balance.asset}`,
        venue: BINANCE.id,
        kind: 'spot',
        asset: balance.asset,
        quantity: total,
        delta: total,
        asOf,
      })
    }

    // A key without futures permission cannot read futures either, and that is
    // not a failure — it is a spot-only account, so the absence is not reported
    // as a broken venue. Only that, and only when Binance said so by code: the
    // catch used to take everything, so a timeout or a 5xx loaded the account
    // with spot balances and no INCOMPLETE — a book with open perps in it
    // answering "nothing can be liquidated".
    let futures: FuturesPosition[] = []
    try {
      futures = await signedGet<FuturesPosition[]>(FUTURES, '/fapi/v2/positionRisk', creds)
    } catch (err) {
      if (!(err instanceof BinanceApiError) || !NO_PERMISSION.has(err.code ?? 0)) throw err
      futures = []
    }

    for (const p of futures) {
      const size = new Decimal(p.positionAmt || '0')
      if (size.isZero()) continue
      // Binance names perps by pair; the asset is what the pair is quoted in.
      const asset = p.symbol.replace(/(USDT|USDC|BUSD|USD)$/, '')
      const liquidation = p.liquidationPrice ? new Decimal(p.liquidationPrice) : null

      positions.push({
        id: `binance:perp:${p.symbol}`,
        venue: BINANCE.id,
        kind: 'perp',
        asset,
        quantity: size,
        delta: size,
        asOf,
        // Binance reports 0 when there is no liquidation price rather than null.
        ...(liquidation && !liquidation.isZero()
          ? {
              liquidation: {
                price: liquidation,
                ...(p.leverage ? { leverage: new Decimal(p.leverage) } : {}),
              },
            }
          : {}),
      })
    }

    return positions
  },
}
