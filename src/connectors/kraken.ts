import { createHash, createHmac } from 'node:crypto'
import Decimal from 'decimal.js'
import { remote, TulaError } from '../core/errors.js'
import type { Position, PositionKind, Venue } from '../core/position.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'
import { request } from '../core/http.js'

const BASE = 'https://api.kraken.com'
const ASSETS = '/0/public/Assets'
const ASSET_PAIRS = '/0/public/AssetPairs'
const BALANCE = '/0/private/Balance'
const BALANCE_EX = '/0/private/BalanceEx'
const WALLET_ACCOUNTS = '/0/private/ListWalletAccounts'
const OPEN_POSITIONS = '/0/private/OpenPositions'
const WITHDRAW_METHODS = '/0/private/WithdrawMethods'

export const KRAKEN: Venue = { id: 'kraken', kind: 'cex', name: 'Kraken' }

export class KrakenAuthError extends TulaError {}
export class KrakenApiError extends TulaError {
  constructor(readonly errors: string[]) {
    // No venue prefix: every caller already says which venue it was asking.
    super(remote(errors.join(', ')))
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

function envelopeErrors(status: number, envelope: KrakenEnvelope<unknown>): string[] | null {
  const errors = envelope.error ?? []
  if (errors.length > 0) return errors
  if (envelope.result === undefined) return [`EGeneral:Empty result (HTTP ${status})`]
  return null
}

async function call<T>(
  path: string,
  creds: ConnectorCredentials,
  params: Record<string, string> = {},
): Promise<CallOutcome<T>> {
  const key = creds['apiKey']
  const secret = creds['apiSecret']
  if (!key || !secret) {
    throw new KrakenAuthError('The stored Kraken credentials are incomplete.\n  Reconnect with /kraken connect.')
  }

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
  const errors = envelopeErrors(res.status, envelope)
  if (errors) return { ok: false, errors }
  return { ok: true, result: envelope.result as T }
}

async function publicGet<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(query).toString()
  const res = await request(`${BASE}${path}${qs ? `?${qs}` : ''}`, {
    headers: { 'User-Agent': 'tula' },
  })
  const envelope = (await res.json()) as KrakenEnvelope<T>
  const errors = envelopeErrors(res.status, envelope)
  if (errors) throw new KrakenApiError(errors)
  return envelope.result as T
}

const permissionDenied = (errors: string[]): boolean =>
  errors.some((e) => e.includes('Permission denied'))

const badCredentials = (errors: string[]): boolean =>
  errors.some((e) => e.includes('Invalid key') || e.includes('Invalid signature'))

const RENAMES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' }

/** Kraken's earned-yield variants: ETH.S staked, .M/.B bonded, .F auto-compounding, .P parachain. */
const STAKED_SUFFIXES = new Set(['S', 'M', 'B', 'F', 'P'])

/**
 * Fiat under a withdrawal hold. Kraken carries it as its own asset code
 * (`USD.HOLD` beside `ZUSD`), so it is a second balance line rather than a
 * portion of the first — the money is yours, and it is not yours to move.
 */
const HELD_SUFFIX = 'HOLD'

export type AssetNames = ReadonlyMap<string, string>

/**
 * Kraken's own name for an asset, from `altname` — never inferred from the code.
 *
 * The legacy X/Z prefixes look like a rule and are not one: nine enabled assets
 * begin with X or Z and are four characters long without being prefixed at all
 * (XAUT, ZORA, ZETA and six more). Stripping the first character renamed Tether
 * Gold to AUT, which prices as nothing or as something else entirely.
 * `altname` is the answer Kraken publishes; the prefix rule is only the
 * fallback for a code the asset list did not carry.
 */
export function normalizeAsset(krakenAsset: string, names: AssetNames = new Map()): {
  asset: string
  kind: PositionKind
} {
  const name = names.get(krakenAsset) ?? legacyName(krakenAsset)
  const dot = name.indexOf('.')
  const suffix = dot === -1 ? '' : name.slice(dot + 1).toUpperCase()
  const base = dot === -1 ? name : name.slice(0, dot)

  const kind: PositionKind = STAKED_SUFFIXES.has(suffix)
    ? 'staked'
    : suffix === HELD_SUFFIX
      ? 'pending'
      : 'spot'
  return { asset: RENAMES[base] ?? base, kind }
}

function legacyName(krakenAsset: string): string {
  const dot = krakenAsset.indexOf('.')
  const base = dot === -1 ? krakenAsset : krakenAsset.slice(0, dot)
  const rest = dot === -1 ? '' : krakenAsset.slice(dot)
  // Four-character codes only: XTZ and XRP are three and must survive intact.
  const stripped = base.length === 4 && (base.startsWith('X') || base.startsWith('Z')) ? base.slice(1) : base
  return stripped + rest
}

interface AssetInfo {
  altname?: string
  status?: string
}

async function assetNames(): Promise<AssetNames> {
  const assets = await publicGet<Record<string, AssetInfo>>(ASSETS)
  const names = new Map<string, string>()
  for (const [code, info] of Object.entries(assets)) {
    if (info.altname) names.set(code, info.altname)
  }
  return names
}

interface PairInfo {
  base?: string
  quote?: string
}

interface WalletAccount {
  account_id?: string
  type?: string
  status?: string
}

interface ExtendedBalance {
  balance?: string
  hold_trade?: string
}

interface OpenPosition {
  pair?: string
  type?: string
  vol?: string
  vol_closed?: string
  cost?: string
  margin?: string
}

/** Every wallet reads under one label until there are two of them to tell apart. */
function walletLabel(account: WalletAccount, total: number): string {
  if (total <= 1) return KRAKEN.id
  return `${KRAKEN.id}-${account.type ?? 'unknown'}`
}

const MISSING_POSITION_SCOPE =
  'This Kraken key cannot read open margin positions, so tula cannot tell you what would\n' +
  '  be liquidated first. Add "Query open orders & trades" to the key — it is a query\n' +
  '  permission and does not allow trading — then reconnect with /kraken connect.'

export const krakenConnector: Connector = {
  venue: KRAKEN,

  fields: [
    {
      name: 'apiKey',
      label: 'API key',
      secret: false,
      hint: 'Query Funds and Query open orders & trades — no trade, no withdraw',
    },
    { name: 'apiSecret', label: 'API secret', secret: true },
  ],

  help: [
    { label: 'Create an API key', url: 'https://support.kraken.com/articles/360000919966-how-to-create-an-api-key' },
    { label: 'What each permission does', url: 'https://docs.kraken.com/exchange/guides/rest/api-keys' },
    { label: 'API key security', url: 'https://support.kraken.com/articles/api-key-security' },
  ],

  // Trade permission only: every endpoint that would prove it also places an
  // order. Withdraw is proven, by an endpoint that reads without moving funds.
  unprovable: ['trade'],

  coverage: {
    reads: [
      'spot, staked and held balances in every wallet ListWalletAccounts returns',
      'open spot-margin positions, as a base leg and the loan funding it',
      'the free/held split of a single-wallet account, from BalanceEx',
    ],
    doesNotRead: [
      {
        what: 'the account margin level',
        why:
          'Kraken liquidates on an account-wide margin level, and a position carries no ' +
          'account-level field. Read as a health factor it would understate the move to ' +
          'liquidation by the leverage on the book.',
        hides: 'liquidation',
        plan: 'tasks/breadth/15-kraken-depth.md',
      },
      {
        what: 'Kraken Futures positions',
        why: 'a separate product on futures.kraken.com with its own keys, which tula does not ask for',
        hides: 'liquidation',
        plan: 'tasks/breadth/15-kraken-depth.md',
      },
      {
        what: 'the free/held split once a margin position is open',
        why:
          'Kraken states that held amounts cover spot non-margin orders only, so the free ' +
          'figure would omit what the margin book has encumbered',
        hides: 'availability',
        plan: 'tasks/breadth/15-kraken-depth.md',
      },
      {
        what: 'the free/held split across several wallets',
        why: 'BalanceEx takes no account_id, so its holds describe one wallet tula cannot identify',
        hides: 'availability',
        plan: 'tasks/breadth/15-kraken-depth.md',
      },
      {
        what: 'drawn credit lines',
        why: 'BalanceEx reports credit and credit_used only for accounts that have a credit line, and a drawn line is a liability with no position to hang it on',
        hides: 'value',
        plan: 'tasks/breadth/15-kraken-depth.md',
      },
    ],
  },

  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const balance = await call<Record<string, string>>(BALANCE, creds)
    if (!balance.ok && badCredentials(balance.errors)) throw new KrakenApiError(balance.errors)

    // Refused here rather than at the first fetch: a key that reads balances and
    // not positions answers "nothing can be liquidated" about a leveraged book,
    // and connect is where the user still has the key page open.
    const positions = await call<unknown>(OPEN_POSITIONS, creds)
    if (!positions.ok && permissionDenied(positions.errors)) {
      throw new TulaError(MISSING_POSITION_SCOPE)
    }

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
    const names = await assetNames()

    // Documented as needing no permission at all, so an older key still reaches
    // it — and a second wallet nobody read is a portfolio missing a wallet.
    const wallets = await call<{ accounts?: WalletAccount[] }>(WALLET_ACCOUNTS, creds)
    const accounts = wallets.ok ? (wallets.result.accounts ?? []) : []

    const open = await call<Record<string, OpenPosition>>(OPEN_POSITIONS, creds)
    if (!open.ok) {
      throw permissionDenied(open.errors) ? new TulaError(MISSING_POSITION_SCOPE) : new KrakenApiError(open.errors)
    }
    const margin = Object.entries(open.result)

    // Kraken's responses carry no timestamp, so freshness is when we received them.
    const asOf = new Date()
    const positions: Position[] = []

    if (accounts.length <= 1) {
      const balances = await call<Record<string, ExtendedBalance>>(BALANCE_EX, creds)
      if (!balances.ok) throw new KrakenApiError(balances.errors)
      const label = accounts[0] ? walletLabel(accounts[0], accounts.length) : KRAKEN.id
      positions.push(...spotRows(balances.result, names, label, asOf, margin.length === 0))
    } else {
      for (const account of accounts) {
        if (!account.account_id) continue
        const balances = await call<Record<string, string>>(BALANCE, creds, {
          account_id: account.account_id,
        })
        if (!balances.ok) throw new KrakenApiError(balances.errors)
        const plain: Record<string, ExtendedBalance> = {}
        for (const [asset, amount] of Object.entries(balances.result)) plain[asset] = { balance: amount }
        positions.push(...spotRows(plain, names, walletLabel(account, accounts.length), asOf, false))
      }
    }

    positions.push(...(await marginRows(margin, names, asOf)))
    return positions
  },
}

/**
 * `split` is false wherever the held figure would be wrong rather than absent:
 * Kraken's holds cover spot non-margin orders only, so once a margin position
 * exists a "free" row would name a number the margin book has already claimed.
 */
function spotRows(
  balances: Record<string, ExtendedBalance>,
  names: AssetNames,
  label: string,
  asOf: Date,
  split: boolean,
): Position[] {
  const byId = new Map<string, Position>()

  const add = (asset: string, kind: PositionKind, quantity: Decimal) => {
    if (quantity.isZero()) return
    const id = `${label}:${kind}:${asset}`
    const existing = byId.get(id)
    // ETH.S and ETH.M both normalize to staked ETH; they are one exposure.
    const merged = existing ? existing.quantity.plus(quantity) : quantity
    byId.set(id, { id, venue: label, kind, asset, quantity: merged, delta: merged, asOf })
  }

  for (const [code, entry] of Object.entries(balances)) {
    const total = new Decimal(entry.balance ?? '0')
    if (total.isZero()) continue
    const { asset, kind } = normalizeAsset(code, names)
    const held = split ? Decimal.min(new Decimal(entry.hold_trade ?? '0'), total) : new Decimal(0)
    add(asset, kind, total.minus(held))
    // Held funds are still exposure, so they stay in the book; `pending` is the
    // model's word for money that is yours and not yours to move.
    add(asset, 'pending', held)
  }

  return [...byId.values()]
}

/**
 * A Kraken margin position is invisible in balances — opening one moves nothing
 * — so it is read as the two things it actually is: the asset the position is
 * long or short, and the loan that paid for it. Netting only the first would
 * report a 5x long as though it were owned outright.
 */
async function marginRows(
  entries: Array<[string, OpenPosition]>,
  names: AssetNames,
  asOf: Date,
): Promise<Position[]> {
  if (entries.length === 0) return []

  const label = `${KRAKEN.id}-margin`
  const pairCodes = [...new Set(entries.map(([, p]) => p.pair).filter((p): p is string => Boolean(p)))]
  const pairs = await publicGet<Record<string, PairInfo>>(ASSET_PAIRS, { pair: pairCodes.join(',') })

  const positions: Position[] = []
  for (const [txid, position] of entries) {
    const pair = position.pair ? pairs[position.pair] : undefined
    if (!pair?.base || !pair.quote) {
      throw new KrakenApiError([`EGeneral:Unknown pair ${remote(position.pair ?? '')}`])
    }

    const size = new Decimal(position.vol ?? '0').minus(position.vol_closed ?? '0')
    if (size.isZero()) continue
    const short = position.type === 'sell'
    const cost = new Decimal(position.cost ?? '0')
    const initial = new Decimal(position.margin ?? '0')

    const base = normalizeAsset(pair.base, names).asset
    const quote = normalizeAsset(pair.quote, names).asset
    const exposure = short ? size.negated() : size
    const loan = short ? cost : cost.negated()

    positions.push({
      id: `${label}:${short ? 'debt' : 'collateral'}:${base}:${txid}`,
      venue: label,
      kind: short ? 'debt' : 'collateral',
      asset: base,
      quantity: exposure,
      delta: exposure,
      asOf,
      encumbers: [`${label}:${short ? 'collateral' : 'debt'}:${quote}:${txid}`],
      // Kraken publishes no liquidation price and liquidates the account rather
      // than the position, so the distance is unknown. The leverage is what
      // `liquidation` is written for at all — and writing it is what puts this
      // row in "what breaks first" as unranked instead of leaving it out, so a
      // position Kraken reported no initial margin against is absent there.
      ...(initial.isZero() ? {} : { liquidation: { leverage: cost.div(initial).abs() } }),
    })

    positions.push({
      id: `${label}:${short ? 'collateral' : 'debt'}:${quote}:${txid}`,
      venue: label,
      kind: short ? 'collateral' : 'debt',
      asset: quote,
      quantity: loan,
      delta: loan,
      asOf,
      encumbers: [`${label}:${short ? 'debt' : 'collateral'}:${base}:${txid}`],
    })
  }

  return positions
}
