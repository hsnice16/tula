import { createPrivateKey, createSign, randomBytes, sign as edSign, type KeyObject } from 'node:crypto'
import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
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
  if (der[0] !== 0x30) throw new TulaError('Unexpected ECDSA signature format.')
  // 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  let offset = der[1] === 0x81 ? 3 : 2
  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new TulaError('Unexpected ECDSA signature format.')
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
        : `Coinbase: HTTP ${res.status} ${text.slice(0, 120)}`,
    )
  }
  return (await res.json()) as T
}

interface KeyPermissions {
  can_view?: boolean
  can_trade?: boolean
  can_transfer?: boolean
}

interface AccountsResponse {
  accounts?: Array<{
    currency?: string
    available_balance?: { value?: string; currency?: string }
    hold?: { value?: string }
  }>
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
    const body = await get<AccountsResponse>('/api/v3/brokerage/accounts?limit=250', creds)
    const asOf = new Date()
    const positions: Position[] = []

    for (const account of body.accounts ?? []) {
      const asset = account.available_balance?.currency ?? account.currency
      if (!asset) continue
      // Held funds are still yours and still exposed, so they belong in the total.
      const total = new Decimal(account.available_balance?.value ?? '0').plus(account.hold?.value ?? '0')
      if (total.isZero()) continue
      positions.push({
        id: `coinbase:spot:${asset}`,
        venue: COINBASE.id,
        kind: 'spot',
        asset,
        quantity: total,
        delta: total,
        asOf,
      })
    }

    return positions
  },
}
