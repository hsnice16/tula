import { createPrivateKey, createSign, randomBytes, sign as edSign, type KeyObject } from 'node:crypto'
import Decimal from 'decimal.js'
import { remote, TulaError } from '../core/errors.js'
import type { Position, Venue } from '../core/position.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'
import { request } from '../core/http.js'

const HOST = 'api.coinbase.com'

export const COINBASE: Venue = { id: 'coinbase', kind: 'cex', name: 'Coinbase Advanced' }

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * A pasted key arrives as one line with its newlines flattened, so PEM has to be
 * rebuilt before `createPrivateKey` will look at it. Refusing a key the user
 * pasted correctly would be the tool's fault, not theirs.
 */
export function normalizeKey(raw: string): string {
  const text = raw.trim().replace(/\\n/g, '\n')
  if (!text.includes('-----BEGIN')) return text
  if (text.includes('\n')) return text

  const match = /-----BEGIN ([A-Z ]+)-----(.*)-----END \1-----/.exec(text)
  if (!match) return text
  const body = (match[2] ?? '').replace(/\s+/g, '')
  const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? body
  return `-----BEGIN ${match[1]}-----\n${wrapped}\n-----END ${match[1]}-----\n`
}

/** CDP Ed25519 secrets are base64 seed+public, not PEM. Wrap the seed as PKCS8. */
function ed25519FromSeed(base64: string): KeyObject | null {
  let bytes: Buffer
  try {
    bytes = Buffer.from(base64, 'base64')
  } catch {
    return null
  }
  if (bytes.length !== 64 && bytes.length !== 32) return null
  const seed = bytes.subarray(0, 32)
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  try {
    return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  } catch {
    return null
  }
}

export function loadKey(raw: string): KeyObject {
  const normalized = normalizeKey(raw)
  try {
    return createPrivateKey(normalized)
  } catch {
    const ed = ed25519FromSeed(normalized)
    if (ed) return ed
    throw new TulaError(
      'That key could not be read. Paste the whole private key from the CDP key file,\n' +
        'including the BEGIN and END lines, or the base64 Ed25519 secret.',
    )
  }
}

/**
 * ECDSA signatures come back DER-wrapped; JOSE wants a fixed 64-byte r||s.
 * Node can do this with `dsaEncoding: 'ieee-p1363'`, but bun's crypto throws on
 * that option, so the conversion is done here — a silently wrong signature would
 * present as "Coinbase rejected your key".
 */
export function derToJose(der: Buffer, size = 32): Buffer {
  // Not a TulaError: this is tula's own signing code disagreeing with itself,
  // which the user can do nothing about and which should keep its stack.
  if (der[0] !== 0x30) throw new Error('Unexpected ECDSA signature format.')
  // 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  let offset = der[1] === 0x81 ? 3 : 2
  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error('Unexpected ECDSA signature format.')
    const length = der[offset + 1] ?? 0
    // DER keeps a leading zero to stay positive; JOSE has no sign byte.
    const value = der.subarray(offset + 2, offset + 2 + length)
    offset += 2 + length
    const trimmed = value[0] === 0 ? value.subarray(1) : value
    return Buffer.concat([Buffer.alloc(Math.max(0, size - trimmed.length)), trimmed])
  }
  const r = readInt()
  const s = readInt()
  return Buffer.concat([r, s])
}

export function buildJwt(keyName: string, signingKey: string, method: string, path: string): string {
  const key = loadKey(signingKey)
  const ed = key.asymmetricKeyType === 'ed25519'
  const now = Math.floor(Date.now() / 1000)

  const header = b64url(
    JSON.stringify({ alg: ed ? 'EdDSA' : 'ES256', kid: keyName, nonce: randomBytes(16).toString('hex'), typ: 'JWT' }),
  )
  const payload = b64url(
    JSON.stringify({ iss: 'cdp', nbf: now, exp: now + 120, sub: keyName, uri: `${method} ${HOST}${path}` }),
  )
  const signingInput = `${header}.${payload}`

  const signature = ed
    ? edSign(null, Buffer.from(signingInput), key)
    : derToJose(createSign('SHA256').update(signingInput).sign(key))

  return `${signingInput}.${b64url(signature)}`
}

async function get<T>(path: string, creds: ConnectorCredentials): Promise<T> {
  const keyName = creds['keyName']?.trim()
  const signingKey = creds['signingKey']
  if (!keyName || !signingKey) throw new TulaError('Coinbase needs a key name and its signing key.')

  const res = await request(`https://${HOST}${path}`, {
    headers: {
      Authorization: `Bearer ${buildJwt(keyName, signingKey, 'GET', path)}`,
      'Content-Type': 'application/json',
      'User-Agent': 'tula',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new TulaError(
      res.status === 401
        ? 'Coinbase rejected the key. Check the key name and that the signing key is complete.'
        : `Coinbase: HTTP ${res.status} ${remote(text)}`,
    )
  }
  return (await res.json()) as T
}

interface KeyPermissions {
  can_view?: boolean
  can_trade?: boolean
  can_transfer?: boolean
  /** The portfolio the key is scoped to; Coinbase derives it from the key itself. */
  portfolio_uuid?: string
}

interface AccountsResponse {
  accounts?: Array<{
    currency?: string
    available_balance?: { value?: string; currency?: string }
    hold?: { value?: string }
  }>
  has_next?: boolean
  cursor?: string
}

/** Native and underlying-currency views of one figure. Coinbase spells the
 *  members of this one in camelCase; the rest of the API is snake_case. */
interface BalancePair {
  rawCurrency?: { value?: string }
  userNativeCurrency?: { value?: string }
}

interface PerpPosition {
  product_id?: string
  symbol?: string
  position_side?: string
  net_size?: string
  leverage?: string
  liquidation_price?: BalancePair
}

interface BreakdownResponse {
  breakdown?: { perp_positions?: PerpPosition[] }
}

const amount = (pair: BalancePair | undefined): string | undefined =>
  pair?.rawCurrency?.value ?? pair?.userNativeCurrency?.value

/**
 * `BTC-PERP-INTX` is one contract on one asset. Split rather than stripped:
 * a suffix list is a guess about names Coinbase adds without telling anyone.
 */
export function perpAsset(productId: string): string {
  return productId.split('-')[0] ?? productId
}

export const coinbaseConnector: Connector = {
  venue: COINBASE,

  fields: [
    {
      name: 'keyName',
      label: 'Key name',
      secret: false,
      hint: 'organizations/…/apiKeys/… from the CDP key file',
    },
    {
      name: 'signingKey',
      label: 'Signing key',
      secret: true,
      hint: 'the CDP API signing key — not a wallet key and not a seed phrase',
    },
  ],

  help: [
    { label: 'Create a CDP API key', url: 'https://docs.cdp.coinbase.com/get-started/authentication/cdp-api-keys' },
    { label: 'Advanced Trade authentication', url: 'https://docs.cdp.coinbase.com/advanced-trade/docs/rest-api-auth' },
    { label: 'Your API keys', url: 'https://portal.cdp.coinbase.com/access/api' },
  ],

  coverage: {
    reads: [
      'every account the key can list, free and held stated apart',
      'perpetual futures positions, with the liquidation price and leverage Coinbase publishes',
    ],
    doesNotRead: [
      {
        what: 'portfolios other than the one the key is scoped to',
        why:
          'Coinbase derives the portfolio from the API key itself, so one key reaches one ' +
          'portfolio. Reaching the rest needs one key each, which the user has to add.',
        hides: 'value',
        plan: 'tasks/breadth/14-coinbase-depth.md',
      },
      {
        what: 'CFTC-regulated futures positions',
        why:
          'Coinbase states a futures position as a contract count beside a contract size, with ' +
          'no documented conversion to asset units, and publishes its liquidation threshold ' +
          'against the account rather than the position',
        hides: 'liquidation',
        plan: 'tasks/breadth/14-coinbase-depth.md',
      },
    ],
  },

  /** Coinbase reports what the key may do, so every field here is proven. */
  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const permissions = await get<KeyPermissions>('/api/v3/brokerage/key_permissions', creds)
    return {
      canRead: permissions.can_view === true,
      canTrade: permissions.can_trade === true,
      canWithdraw: permissions.can_transfer === true,
    }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const asOf = new Date()
    const positions: Position[] = []

    // Followed to the end rather than stopping at the first page. A truncated
    // book is a wrong net exposure that reports itself as complete, and an
    // account holding more currencies than one page is not an exotic case.
    // Bounded so a cursor that never clears cannot spin here forever.
    const accounts: NonNullable<AccountsResponse['accounts']> = []
    let cursor: string | undefined
    let more = false
    for (let page = 0; page < 20; page++) {
      const query = `?limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const body = await get<AccountsResponse>(`/api/v3/brokerage/accounts${query}`, creds)
      accounts.push(...(body.accounts ?? []))
      more = body.has_next === true && Boolean(body.cursor)
      if (!more) break
      cursor = body.cursor
    }
    // Stopping quietly at the bound would be the truncation the loop exists to
    // prevent, reported as a complete account.
    if (more) {
      throw new TulaError(
        'Coinbase has more accounts than tula read in 20 pages.\n' +
          '  This would under-report your balances, so nothing is shown for it.\n' +
          '  Please report it: https://github.com/hsnice16/tula/issues',
      )
    }

    // Held funds are still yours and still exposed, so they stay in the book —
    // as their own row. Summing them into the spot figure was right about the
    // exposure and destroyed the only answer to "how much can I move".
    const byId = new Map<string, Position>()
    const add = (asset: string, kind: 'spot' | 'pending', quantity: Decimal) => {
      if (quantity.isZero()) return
      const id = `coinbase:${kind}:${asset}`
      const merged = byId.get(id)?.quantity.plus(quantity) ?? quantity
      byId.set(id, { id, venue: COINBASE.id, kind, asset, quantity: merged, delta: merged, asOf })
    }

    for (const account of accounts) {
      const asset = account.available_balance?.currency ?? account.currency
      if (!asset) continue
      add(asset, 'spot', new Decimal(account.available_balance?.value ?? '0'))
      add(asset, 'pending', new Decimal(account.hold?.value ?? '0'))
    }
    positions.push(...byId.values())

    positions.push(...(await perpPositions(creds, asOf)))
    return positions
  },
}

/**
 * The accounts list shows the cash a perp account holds and never the position
 * standing against it, so a book one price move from liquidation read as a pile
 * of USDC. The breakdown is where Coinbase publishes the liquidation price.
 */
async function perpPositions(creds: ConnectorCredentials, asOf: Date): Promise<Position[]> {
  // The key names its own portfolio; there is no other way to address it.
  const { portfolio_uuid: portfolio } = await get<KeyPermissions>(
    '/api/v3/brokerage/key_permissions',
    creds,
  )
  if (!portfolio) return []

  const body = await get<BreakdownResponse>(
    `/api/v3/brokerage/portfolios/${encodeURIComponent(portfolio)}`,
    creds,
  )

  const positions: Position[] = []
  for (const perp of body.breakdown?.perp_positions ?? []) {
    const product = perp.product_id ?? perp.symbol
    if (!product) continue
    const size = new Decimal(perp.net_size ?? '0')
    if (size.isZero()) continue
    // Coinbase states the side separately and net_size unsigned on some rows;
    // the side is the authority where it gave one.
    const signed = perp.position_side?.endsWith('SHORT') ? size.abs().negated() : size
    const liquidation = amount(perp.liquidation_price)
    const price = liquidation === undefined ? null : new Decimal(liquidation)

    positions.push({
      id: `coinbase:perp:${product}`,
      venue: COINBASE.id,
      kind: 'perp',
      asset: perpAsset(product),
      quantity: signed,
      delta: signed,
      asOf,
      liquidation: {
        // Written even where Coinbase named no price: the leverage below is
        // still worth carrying, and `rankable` keeps a perp on its kind.
        ...(price && !price.isZero() ? { price } : {}),
        ...(perp.leverage ? { leverage: new Decimal(perp.leverage) } : {}),
      },
    })
  }

  return positions
}
