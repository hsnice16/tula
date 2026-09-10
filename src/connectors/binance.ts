import { createHmac } from 'node:crypto'
import Decimal from 'decimal.js'
import { remote, TulaError } from '../core/errors.js'
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
  if (!key || !secret) {
    throw new TulaError('The stored Binance credentials are incomplete.\n  Reconnect with /binance connect.')
  }

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
    throw new BinanceApiError(`Binance: ${body.msg ? remote(body.msg) : `HTTP ${res.status}`}`, body.code)
  }
  return body
}

interface Restrictions {
  enableReading?: boolean
  enableWithdrawals?: boolean
  enableSpotAndMarginTrading?: boolean
  enableFutures?: boolean
  enableMargin?: boolean
  enableInternalTransfer?: boolean
  permitsUniversalTransfer?: boolean
}

/**
 * Restrictions that move money without being called trading or withdrawal, and
 * the checkbox each one is on Binance's own key page. `enableMargin` reads as a
 * margin *view* permission and is not one: the box it belongs to says "Enable
 * Margin Loan, Repay & Transfer".
 */
const MOVE_FUNDS: Array<[keyof Restrictions, string]> = [
  ['enableMargin', 'Enable Margin Loan, Repay & Transfer'],
  ['enableInternalTransfer', 'Enable Internal Transfer'],
  ['permitsUniversalTransfer', 'Permits Universal Transfer'],
]

interface SpotAccount {
  balances?: Array<{ asset: string; free: string; locked: string }>
}

interface FuturesPosition {
  symbol: string
  positionAmt: string
  liquidationPrice?: string
  leverage?: string
}

interface MarginAsset {
  asset?: string
  netAsset?: string
}

interface CrossMarginAccount {
  userAssets?: MarginAsset[]
}

interface IsolatedMarginAccount {
  assets?: Array<{
    symbol?: string
    enabled?: boolean
    liquidatePrice?: string
    baseAsset?: MarginAsset
    quoteAsset?: MarginAsset
  }>
}

/**
 * The asset a contract tracks. `BTCUSDT_250926` is a quarterly on BTC and used
 * to net against nothing at all, because the settlement date was read as part
 * of the ticker: one book held BTC in three places and reported three assets.
 */
export function contractAsset(symbol: string): string {
  const [pair = symbol] = symbol.split('_')
  return pair.replace(/(USDT|USDC|FDUSD|BUSD|USD)$/, '')
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

  coverage: {
    reads: [
      'spot balances, free and locked stated apart',
      'cross and isolated margin, where the key is allowed to read them',
      'USD-M futures positions, where the key is allowed to read them',
    ],
    doesNotRead: [
      {
        what: 'the margin level a cross-margin account is liquidated at',
        why:
          'Binance publishes 1.1 for Cross Margin Classic and says its tiered accounts differ ' +
          'without publishing theirs, so a distance computed from one number could be wrong in ' +
          'the direction that matters',
        hides: 'liquidation',
        plan: 'tasks/breadth/13-binance-depth.md',
      },
      {
        what: 'COIN-M futures and Portfolio Margin positions',
        why: 'both are gated on trading-scoped key flags, which tula refuses to hold',
        hides: 'liquidation',
        plan: 'tasks/breadth/13-binance-depth.md',
      },
      {
        what: 'the funding wallet, Simple Earn, ETH and SOL staking, Dual Investment and loans',
        why: 'each is a further endpoint nobody has read yet; all are plain reads and none is refused by our rule',
        hides: 'value',
        plan: 'tasks/breadth/13-binance-depth.md',
      },
      {
        what: 'balances frozen, withdrawing or locked for an IPO',
        why: 'the spot account endpoint reports free and locked only; getUserAsset carries the other three',
        hides: 'value',
        plan: 'tasks/breadth/13-binance-depth.md',
      },
      {
        what: 'sub-account balances',
        why: 'a master account can list them and tula asks for one key, which may not be the master',
        hides: 'value',
        plan: 'tasks/breadth/13-binance-depth.md',
      },
    ],
  },

  /**
   * Binance reports permissions directly, so every field here is proven —
   * nothing is `unknown`, unlike Kraken.
   */
  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const r = await signedGet<Restrictions>(SPOT, '/sapi/v1/account/apiRestrictions', creds)

    // Refused by name rather than through the generic over-scope sentence: none
    // of these is a trade or a withdrawal, so that sentence could not say what
    // was wrong, and the user is looking at the page with the box on it.
    const moving = MOVE_FUNDS.filter(([field]) => r[field] === true).map(([, label]) => label)
    if (moving.length > 0) {
      throw new TulaError(
        `Refusing this key: it can move your funds. Turn off ${moving.join(' and ')}\n` +
          '  on the key, or make a new one with Enable Reading only, then connect again.\n' +
          '  "Enable Margin Loan, Repay & Transfer" is a borrowing power, not a way to read margin.',
      )
    }

    return {
      canRead: r.enableReading === true,
      canTrade: r.enableSpotAndMarginTrading === true || r.enableFutures === true,
      canWithdraw: r.enableWithdrawals === true,
      canMoveFunds: false,
    }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const spot = await signedGet<SpotAccount>(SPOT, '/api/v3/account', creds)
    const asOf = new Date()
    const positions: Position[] = []

    for (const balance of spot.balances ?? []) {
      // Locked is exposure and is not yours to move, so it stays in the book as
      // its own row. Summed into the free figure it answered the wrong question.
      for (const [kind, raw] of [
        ['spot', balance.free],
        ['pending', balance.locked],
      ] as const) {
        const quantity = new Decimal(raw)
        if (quantity.isZero()) continue
        positions.push({
          id: `binance:${kind}:${balance.asset}`,
          venue: BINANCE.id,
          kind,
          asset: balance.asset,
          quantity,
          delta: quantity,
          asOf,
        })
      }
    }

    positions.push(...(await marginPositions(creds, asOf)))

    // A key without futures permission cannot read futures either, and that is
    // not a failure — it is a spot-only account, so the absence is not reported
    // as a broken venue. Only that, and only when Binance said so by code: the
    // catch used to take everything, so a timeout or a 5xx loaded the account
    // with spot balances and no INCOMPLETE — a book with open perps in it
    // answering "nothing can be liquidated".
    // Unreachable with any key tula will store: Binance's futures permission
    // grants futures *trading*, so `verifyScope` reports canTrade and connect
    // refuses the key. Kept because the refusal is the thing that could
    // change — the permission split, or a read-only futures scope — and this
    // is what would have to be right on the day it does. README's Status table
    // says futures is not read while tula is read-only, and why.
    const futures = await optional<FuturesPosition[]>(FUTURES, '/fapi/v2/positionRisk', creds)

    for (const p of futures ?? []) {
      const size = new Decimal(p.positionAmt || '0')
      if (size.isZero()) continue
      const asset = contractAsset(p.symbol)
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

/**
 * Whether reading a margin account needs the borrow-and-transfer permission is
 * undocumented in either direction — the endpoints are plain USER_DATA and
 * carry no permission note, while the margin guide says only that "margin API
 * calls will be rejected" without separating a read from a loan. So the call is
 * made and a permission refusal is taken as an account with no margin on it;
 * anything else is a venue that failed and has to say so.
 */
async function marginPositions(creds: ConnectorCredentials, asOf: Date): Promise<Position[]> {
  const label = `${BINANCE.id}-margin`
  const positions: Position[] = []

  const row = (asset: string, raw: string | undefined, id: string, price?: Decimal) => {
    const quantity = new Decimal(raw ?? '0')
    if (quantity.isZero()) return
    positions.push({
      id,
      venue: label,
      kind: quantity.isNegative() ? 'debt' : 'collateral',
      asset,
      quantity,
      delta: quantity,
      asOf,
      // Present even when empty: a margined asset can be liquidated, and a row
      // with no liquidation at all is dropped from "what breaks first" rather
      // than ranked last as unknown.
      liquidation: price && !price.isZero() ? { price } : {},
    })
  }

  const cross = await optional<CrossMarginAccount>(SPOT, '/sapi/v1/margin/account', creds)
  for (const asset of cross?.userAssets ?? []) {
    if (asset.asset) row(asset.asset, asset.netAsset, `${label}:cross:${asset.asset}`)
  }

  const isolated = await optional<IsolatedMarginAccount>(SPOT, '/sapi/v1/margin/isolated/account', creds)
  for (const pair of isolated?.assets ?? []) {
    if (pair.enabled === false || !pair.symbol) continue
    const price = pair.liquidatePrice ? new Decimal(pair.liquidatePrice) : undefined
    const base = pair.baseAsset?.asset
    const quote = pair.quoteAsset?.asset
    // The liquidation price is quoted in the quote asset and reached by the
    // base asset moving, so it belongs to the base leg and nowhere else.
    if (base) row(base, pair.baseAsset?.netAsset, `${label}:${pair.symbol}:${base}`, price)
    if (quote) row(quote, pair.quoteAsset?.netAsset, `${label}:${pair.symbol}:${quote}`)
  }

  return positions
}

async function optional<T>(
  base: string,
  path: string,
  creds: ConnectorCredentials,
): Promise<T | null> {
  try {
    return await signedGet<T>(base, path, creds)
  } catch (err) {
    if (err instanceof BinanceApiError && NO_PERMISSION.has(err.code ?? 0)) return null
    throw err
  }
}
