import { afterEach, describe, expect, test } from 'bun:test'
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
