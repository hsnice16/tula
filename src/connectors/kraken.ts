import { createHash, createHmac } from 'node:crypto'
import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { Position, PositionKind, Venue } from '../core/position.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'
import { request } from '../core/http.js'

const BASE = 'https://api.kraken.com'
const BALANCE = '/0/private/Balance'
const WITHDRAW_METHODS = '/0/private/WithdrawMethods'

export const KRAKEN: Venue = { id: 'kraken', kind: 'cex', name: 'Kraken' }

export class KrakenAuthError extends TulaError {}
export class KrakenApiError extends TulaError {
  constructor(readonly errors: string[]) {
    // No venue prefix: every caller already says which venue it was asking.
    super(errors.join(', '))
  }
}

let lastNonce = 0

function nextNonce(): string {
  // Kraken rejects a nonce that does not strictly increase, and scope
  // verification fires two calls that can land in the same millisecond.
  lastNonce = Math.max(Date.now(), lastNonce + 1)
  return String(lastNonce)
}

function decodeSecret(secret: string): Buffer {
  const buf = Buffer.from(secret, 'base64')
  // Buffer.from is lenient: bad base64 yields a short buffer and a signature
  // that fails as EAPI:Invalid signature, which reads as the wrong problem.
  if (buf.length < 32) throw new KrakenAuthError('Kraken API secret is not valid base64.')
  return buf
}

export function sign(path: string, body: URLSearchParams, secret: string): string {
  const inner = createHash('sha256')
    .update((body.get('nonce') ?? '') + body.toString())
    .digest()
  return createHmac('sha512', decodeSecret(secret))
    .update(path)
    .update(inner)
    .digest('base64')
}

interface KrakenEnvelope<T> {
  error?: string[]
  result?: T
}

type CallOutcome<T> = { ok: true; result: T } | { ok: false; errors: string[] }

async function call<T>(
  path: string,
  creds: ConnectorCredentials,
  params: Record<string, string> = {},
): Promise<CallOutcome<T>> {
  const key = creds['apiKey']
  const secret = creds['apiSecret']
  if (!key || !secret) throw new KrakenAuthError('Kraken credentials must have apiKey and apiSecret.')

  const body = new URLSearchParams({ nonce: nextNonce(), ...params })
  const res = await request(BASE + path, {
    method: 'POST',
    headers: {
      'API-Key': key,
      'API-Sign': sign(path, body, secret),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'tula',
    },
    body,
  })

  // Kraken answers 200 with a populated `error` array for most failures, so
  // the status alone is not a success test.
  if (!res.ok && res.status >= 500) {
    return { ok: false, errors: [`EService:Unavailable (HTTP ${res.status})`] }
  }

  const envelope = (await res.json()) as KrakenEnvelope<T>
  const errors = envelope.error ?? []
  if (errors.length > 0) return { ok: false, errors }
  if (envelope.result === undefined) return { ok: false, errors: ['EGeneral:Empty result'] }
  return { ok: true, result: envelope.result }
}

const permissionDenied = (errors: string[]): boolean =>
  errors.some((e) => e.includes('Permission denied'))

const badCredentials = (errors: string[]): boolean =>
  errors.some((e) => e.includes('Invalid key') || e.includes('Invalid signature'))

const RENAMES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' }

/** Kraken's earned-yield variants: ETH.S staked, .M/.B bonded, .F auto-compounding. */
const YIELD_SUFFIXES = new Set(['S', 'M', 'B', 'F', 'P'])

export function normalizeAsset(krakenAsset: string): { asset: string; kind: PositionKind } {
  const dot = krakenAsset.indexOf('.')
  const suffix = dot === -1 ? '' : krakenAsset.slice(dot + 1)
  let base = dot === -1 ? krakenAsset : krakenAsset.slice(0, dot)

  // Legacy ISO-4217-style prefixes (X crypto, Z fiat) apply to four-character
  // codes only. XTZ and XRP are three characters and must survive intact.
  if (base.length === 4 && (base.startsWith('X') || base.startsWith('Z'))) base = base.slice(1)

  const kind: PositionKind = YIELD_SUFFIXES.has(suffix.charAt(0)) ? 'staked' : 'spot'
  return { asset: RENAMES[base] ?? base, kind }
}

export const krakenConnector: Connector = {
  venue: KRAKEN,

  fields: [
    { name: 'apiKey', label: 'API key', secret: false, hint: 'Query Funds only — no trade, no withdraw' },
    { name: 'apiSecret', label: 'API secret', secret: true },
  ],

  help: [
    { label: 'Create an API key', url: 'https://support.kraken.com/articles/360000919966-how-to-create-an-api-key' },
    { label: 'What each permission does', url: 'https://docs.kraken.com/exchange/guides/rest/api-keys' },
    { label: 'API key security', url: 'https://support.kraken.com/articles/api-key-security' },
  ],

  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const balance = await call<Record<string, string>>(BALANCE, creds)
    if (!balance.ok && badCredentials(balance.errors)) throw new KrakenApiError(balance.errors)

    const withdraw = await call<unknown>(WITHDRAW_METHODS, creds)

    return {
      canRead: balance.ok,
      // Kraken exposes no endpoint that reports a key's permissions, and every
      // endpoint gated on "Create & modify orders" places or mutates an order.
      // Probing it would mean shipping AddOrder in a tool that promises it
      // cannot move money, so this stays unproven by design.
      canTrade: 'unknown',
      // WithdrawMethods only lists methods, but it is gated on "Withdraw Funds",
      // so a success is proof the key holds that permission.
      canWithdraw: withdraw.ok ? true : permissionDenied(withdraw.errors) ? false : 'unknown',
    }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const balance = await call<Record<string, string>>(BALANCE, creds)
    if (!balance.ok) throw new KrakenApiError(balance.errors)

    // Kraken's response carries no timestamp, so freshness is when we received it.
    const asOf = new Date()
    const byId = new Map<string, Position>()

    for (const [krakenAsset, raw] of Object.entries(balance.result)) {
      const quantity = new Decimal(raw)
      if (quantity.isZero()) continue

      const { asset, kind } = normalizeAsset(krakenAsset)
      const id = `kraken:${kind}:${asset}`
      const existing = byId.get(id)

      // ETH.S and ETH.M both normalize to staked ETH; they are one exposure.
      const merged = existing ? existing.quantity.plus(quantity) : quantity
      byId.set(id, {
        id,
        venue: KRAKEN.id,
        kind,
        asset,
        quantity: merged,
        delta: merged,
        asOf,
      })
    }

    return [...byId.values()]
  },
}
