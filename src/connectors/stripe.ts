import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { Position, Venue } from '../core/position.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'
import { request } from '../core/http.js'

const API = 'https://api.stripe.com/v1'

export const STRIPE: Venue = { id: 'stripe', kind: 'payments', name: 'Stripe' }

/**
 * Stripe quotes in the currency's minor unit, and not every currency has two of
 * them. Dividing everything by 100 would report a JPY balance as a hundredth of
 * itself — a silent, plausible-looking wrong number.
 * https://docs.stripe.com/currencies#zero-decimal
 */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])

export function minorUnits(currency: string): number {
  const code = currency.toUpperCase()
  if (ZERO_DECIMAL.has(code)) return 0
  if (THREE_DECIMAL.has(code)) return 3
  return 2
}

interface BalanceEntry {
  amount: number
  currency: string
}

interface BalanceResponse {
  available?: BalanceEntry[]
  pending?: BalanceEntry[]
  livemode?: boolean
  error?: { message?: string; type?: string }
}

async function get<T>(path: string, apiKey: string): Promise<T> {
  const res = await request(`${API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'tula' },
  })
  const body = (await res.json()) as T & { error?: { message?: string } }
  if (!res.ok) {
    throw new TulaError(`Stripe: ${body.error?.message ?? `HTTP ${res.status}`}`)
  }
  return body
}

const toAmount = (entry: BalanceEntry): Decimal =>
  new Decimal(entry.amount).div(new Decimal(10).pow(minorUnits(entry.currency)))

export const stripeConnector: Connector = {
  venue: STRIPE,

  fields: [
    {
      name: 'apiKey',
      label: 'Restricted key',
      secret: true,
      hint: 'starts rk_ — a read-only restricted key, never your sk_ secret key',
    },
  ],

  help: [
    { label: 'Create a restricted key', url: 'https://docs.stripe.com/keys#limit-access' },
    { label: 'Your API keys', url: 'https://dashboard.stripe.com/apikeys' },
    { label: 'How balances work', url: 'https://docs.stripe.com/api/balance' },
  ],

  /**
   * Stripe does not report what a restricted key may do, so trade and withdraw
   * stay unproven. What it does expose is the key's *class*, and a secret key
   * can create payouts and transfers — so that one is refused outright rather
   * than reported as an unknown.
   */
  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const apiKey = creds['apiKey']?.trim()
    if (!apiKey) throw new TulaError('Stripe needs a restricted API key.')

    if (apiKey.startsWith('pk_')) {
      throw new TulaError(
        'That is a publishable key. It cannot read your balance. You need a restricted key (rk_).',
      )
    }
    if (apiKey.startsWith('sk_')) {
      return { canRead: true, canTrade: true, canWithdraw: true }
    }
    if (!apiKey.startsWith('rk_')) {
      throw new TulaError('That does not look like a Stripe key. Restricted keys start with rk_.')
    }

    await get<BalanceResponse>('/balance', apiKey)
    return { canRead: true, canTrade: 'unknown', canWithdraw: 'unknown' }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const apiKey = creds['apiKey']?.trim()
    if (!apiKey) throw new TulaError('Stripe needs a restricted API key.')

    const balance = await get<BalanceResponse>('/balance', apiKey)
    const asOf = new Date()
    const positions: Position[] = []

    const add = (entry: BalanceEntry, kind: 'spot' | 'pending') => {
      const quantity = toAmount(entry)
      if (quantity.isZero()) return
      const asset = entry.currency.toUpperCase()
      positions.push({
        id: `stripe:${kind}:${asset}`,
        venue: STRIPE.id,
        kind,
        asset,
        quantity,
        delta: quantity,
        asOf,
      })
    }

    for (const entry of balance.available ?? []) add(entry, 'spot')
    // Pending is yours but not yet movable, so it is a distinct row rather than
    // being folded into the available balance.
    for (const entry of balance.pending ?? []) add(entry, 'pending')

    return positions
  },
}
