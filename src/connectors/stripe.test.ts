import { afterEach, describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import { belongsToVenue } from '../core/position.js'
import { minorUnits, stripeConnector } from './stripe.js'

const original = globalThis.fetch

function stub(body: unknown, status = 200) {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = original
})

describe('minorUnits', () => {
  test('most currencies have two', () => {
    expect(minorUnits('usd')).toBe(2)
    expect(minorUnits('EUR')).toBe(2)
  })

  test('zero-decimal currencies have none', () => {
    // Dividing JPY by 100 reports a hundredth of the balance, and it looks plausible.
    expect(minorUnits('jpy')).toBe(0)
    expect(minorUnits('KRW')).toBe(0)
  })

  test('three-decimal currencies have three', () => {
    expect(minorUnits('KWD')).toBe(3)
  })
})

describe('stripe scope', () => {
  test('a secret key reports that it can move money, so connect refuses it', async () => {
    expect(await stripeConnector.verifyScope({ apiKey: 'sk_live_x' })).toEqual({
      canRead: true,
      canTrade: true,
      canWithdraw: true,
    })
  })

  test('a publishable key is rejected with the reason', async () => {
    await expect(stripeConnector.verifyScope({ apiKey: 'pk_live_x' })).rejects.toThrow(/publishable/)
  })

  test('something that is not a Stripe key is rejected', async () => {
    await expect(stripeConnector.verifyScope({ apiKey: 'hunter2' })).rejects.toThrow(/rk_/)
  })

  test('a restricted key reads, and its other powers stay unproven', async () => {
    stub({ available: [], pending: [] })
    expect(await stripeConnector.verifyScope({ apiKey: 'rk_live_x' })).toEqual({
      canRead: true,
      canTrade: 'unknown',
      canWithdraw: 'unknown',
    })
  })
})

describe('stripe balances', () => {
  test('minor units are converted per currency, not divided by 100', async () => {
    stub({
      available: [
        { amount: 123456, currency: 'usd' },
        { amount: 500000, currency: 'jpy' },
      ],
      pending: [],
    })
    const positions = await stripeConnector.fetchPositions({ apiKey: 'rk_live_x' })
    expect(positions.find((p) => p.asset === 'USD')?.quantity.toString()).toBe('1234.56')
    expect(positions.find((p) => p.asset === 'JPY')?.quantity.toString()).toBe('500000')
  })

  test('pending is a separate row, not folded into available', async () => {
    stub({
      available: [{ amount: 1000, currency: 'usd' }],
      pending: [{ amount: 2500, currency: 'usd' }],
    })
    const positions = await stripeConnector.fetchPositions({ apiKey: 'rk_live_x' })
    expect(positions.find((p) => p.kind === 'spot')?.quantity.toString()).toBe('10')
    expect(positions.find((p) => p.kind === 'pending')?.quantity.toString()).toBe('25')
  })

  test('zero balances are dropped', async () => {
    stub({ available: [{ amount: 0, currency: 'usd' }], pending: [] })
    expect(await stripeConnector.fetchPositions({ apiKey: 'rk_live_x' })).toEqual([])
  })

  test('an API error becomes a message, not a raw body', async () => {
    stub({ error: { message: 'Invalid API Key provided' } }, 401)
    await expect(stripeConnector.fetchPositions({ apiKey: 'rk_live_x' })).rejects.toThrow(
      /Invalid API Key/,
    )
  })
})

/**
 * Built from Stripe's documented Balance object — a live key is required, so
 * this could not be captured. Note the nesting Stripe uses: `issuing` and
 * `refund_and_dispute_prefunding` are objects wrapping arrays, while
 * `connect_reserved` and `instant_available` are arrays like `available`.
 * https://docs.stripe.com/api/balance/balance_object
 */
const BALANCE = {
  object: 'balance',
  available: [{ amount: 120000, currency: 'usd' }],
  pending: [{ amount: 45000, currency: 'usd' }],
  connect_reserved: [{ amount: 30000, currency: 'usd' }],
  instant_available: [{ amount: 90000, currency: 'usd' }],
  issuing: { available: [{ amount: 250000, currency: 'usd' }] },
  refund_and_dispute_prefunding: {
    available: [{ amount: 10000, currency: 'usd' }],
    pending: [{ amount: 5000, currency: 'usd' }],
  },
  livemode: true,
}

describe('stripe balance buckets', () => {
  // Money for Issued Cards is the account's and is in none of the two buckets
  // tula used to read, so a card programme funded from Stripe was invisible.
  test('money that is only spendable on issued cards is still in the book', async () => {
    stub(BALANCE)
    const positions = await stripeConnector.fetchPositions({ apiKey: 'rk_live_x' })
    const issuing = positions.find((p) => p.venue === 'stripe-issuing')
    expect(issuing?.quantity.toString()).toBe('2500')
  })

  test('reserved and prefunded balances are named apart from the available one', async () => {
    stub(BALANCE)
    const positions = await stripeConnector.fetchPositions({ apiKey: 'rk_live_x' })
    expect(positions.find((p) => p.venue === 'stripe-connect-reserved')?.quantity.toString()).toBe('300')
    const prefunding = positions.filter((p) => p.venue === 'stripe-prefunding')
    expect(prefunding.find((p) => p.kind === 'spot')?.quantity.toString()).toBe('100')
    expect(prefunding.find((p) => p.kind === 'pending')?.quantity.toString()).toBe('50')
  })

  test('every row belongs to Stripe however its bucket is labelled', async () => {
    stub(BALANCE)
    const positions = await stripeConnector.fetchPositions({ apiKey: 'rk_live_x' })
    expect(positions.every((p) => belongsToVenue(p.venue, 'stripe'))).toBe(true)
    expect(new Set(positions.map((p) => p.id)).size).toBe(positions.length)
  })

  // instant_available is the part of `available` payable out instantly, so a
  // row for it would state the same money twice.
  test('the instantly payable slice is not counted a second time', async () => {
    stub(BALANCE)
    const positions = await stripeConnector.fetchPositions({ apiKey: 'rk_live_x' })
    const total = positions.reduce((sum, p) => sum.plus(p.quantity), new Decimal(0))
    expect(total.toString()).toBe('4600')
  })
})

// Written to be broken by progress: closing this fails the test, so the line
// claiming tula does not read it has to go in the same change.
describe('stripe declared gaps', () => {
  test('Treasury financial accounts are still unread — delete the gap when they are', async () => {
    const reached: string[] = []
    globalThis.fetch = (async (url: unknown) => {
      reached.push(String(url))
      return new Response(JSON.stringify(BALANCE), { status: 200 })
    }) as unknown as typeof fetch
    await stripeConnector.fetchPositions({ apiKey: 'rk_live_x' })
    expect(reached.some((url) => url.includes('/treasury/'))).toBe(false)
  })

  /**
   * Not a second endpoint but a header on the same one: `Stripe-Account` is how
   * a platform key asks for a connected account's balance, so a URL check
   * cannot see this gap close. The headers can, and nothing else in this
   * connector sends one.
   */
  test('connected accounts are still unread — delete the gap when a Stripe-Account header goes out', async () => {
    expect(
      (stripeConnector.coverage?.doesNotRead ?? []).some((g) =>
        g.what.includes('connected accounts under a platform'),
      ),
    ).toBe(true)
    const sent: string[] = []
    globalThis.fetch = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      sent.push(...Object.keys(init?.headers ?? {}).map((h) => h.toLowerCase()))
      return new Response(JSON.stringify(BALANCE), { status: 200 })
    }) as unknown as typeof fetch
    await stripeConnector.fetchPositions({ apiKey: 'rk_live_x' })
    expect(sent.length).toBeGreaterThan(0)
    expect(sent).not.toContain('stripe-account')
  })
})
