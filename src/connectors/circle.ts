import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { Position, Venue } from '../core/position.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'
import { request } from '../core/http.js'

const API = 'https://api.circle.com/v1'

export const CIRCLE: Venue = { id: 'circle', kind: 'payments', name: 'Circle Mint' }

/** Circle keys are `ENV:keyId:secret`; the API rejects anything else as malformed. */
export const KEY_SHAPE = /^[A-Za-z0-9_]+:[a-f0-9]+:[a-f0-9]+$/

interface BalanceEntry {
  amount: string
  currency: string
}

interface BalancesResponse {
  data?: { available?: BalanceEntry[]; unsettled?: BalanceEntry[] }
  message?: string
}

async function get<T>(path: string, apiKey: string): Promise<T> {
  const res = await request(`${API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'tula' },
  })
  const body = (await res.json()) as T & { message?: string }
  if (!res.ok) throw new TulaError(`Circle: ${body.message ?? `HTTP ${res.status}`}`)
  return body
}

export const circleConnector: Connector = {
  venue: CIRCLE,

  fields: [
    {
      name: 'apiKey',
      label: 'Restricted API key',
      secret: true,
      hint: 'ENV:id:secret — create a Restricted Key with read access only',
    },
  ],

  help: [
    {
      label: 'Create a restricted API key',
      url: 'https://developers.circle.com/circle-mint/getting-started-with-the-circle-core-api',
    },
    {
      label: 'Balances endpoint',
      url: 'https://developers.circle.com/api-reference/circle-mint/account/list-business-balances',
    },
    { label: 'Wallet policy and approvals', url: 'https://help.circle.com/s/article/Circle-Account-wallet-policy-permissions-and-approvals-setup' },
  ],

  /**
   * Circle supports Restricted Keys but exposes no way to read what one may do,
   * so transfer and redeem stay unproven. Unlike Stripe there is no prefix that
   * distinguishes a full-access key, which is why the connect screen has to say
   * plainly that tula could not check.
   */
  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const apiKey = creds['apiKey']?.trim()
    if (!apiKey) throw new TulaError('Circle needs an API key.')
    if (!KEY_SHAPE.test(apiKey)) {
      throw new TulaError(
        'That is not a Circle key. They look like ENV:keyId:secret — three parts separated by colons.',
      )
    }
    await get<BalancesResponse>('/businessAccount/balances', apiKey)
    return { canRead: true, canTrade: 'unknown', canWithdraw: 'unknown' }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const apiKey = creds['apiKey']?.trim()
    if (!apiKey) throw new TulaError('Circle needs an API key.')

    const body = await get<BalancesResponse>('/businessAccount/balances', apiKey)
    const asOf = new Date()
    const positions: Position[] = []

    const add = (entry: BalanceEntry, kind: 'spot' | 'pending') => {
      // Circle quotes whole units, not minor units — no cents conversion here.
      const quantity = new Decimal(entry.amount)
      if (quantity.isZero()) return
      const asset = entry.currency.toUpperCase()
      positions.push({
        id: `circle:${kind}:${asset}`,
        venue: CIRCLE.id,
        kind,
        asset,
        quantity,
        delta: quantity,
        asOf,
      })
    }

    for (const entry of body.data?.available ?? []) add(entry, 'spot')
    // Unsettled is yours but not yet usable, the same distinction Stripe draws.
    for (const entry of body.data?.unsettled ?? []) add(entry, 'pending')

    return positions
  },
}
