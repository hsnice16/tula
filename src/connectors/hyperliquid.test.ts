import { afterEach, describe, expect, test } from 'bun:test'
import { hyperliquidConnector } from './hyperliquid.js'

const ADDRESS = '0x0000000000000000000000000000000000000abc'
const VENUE_TIME = 1788115918781

// Shapes recorded from api.hyperliquid.xyz, trimmed to what the connector reads.
const PERPS = {
  marginSummary: { accountValue: '10000.0', totalMarginUsed: '500.0' },
  withdrawable: '2500.5',
  time: VENUE_TIME,
  assetPositions: [
    {
      type: 'oneWay',
      position: {
        coin: 'BTC',
        szi: '-0.36296',
        leverage: { type: 'cross', value: 20 },
        entryPx: '78553.5',
        liquidationPx: '8334793.0463984795',
      },
    },
    // A cross position far from liquidation reports null, not zero.
    { type: 'oneWay', position: { coin: 'ATOM', szi: '953.87', liquidationPx: null } },
    { type: 'oneWay', position: { coin: 'SOL', szi: '0.0', liquidationPx: '1' } },
  ],
}

const SPOT = { balances: [{ coin: 'PURR', total: '120.5' }, { coin: 'HYPE', total: '0.0' }] }

const original = globalThis.fetch

function stub(perps: unknown = PERPS, spot: unknown = SPOT) {
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    const type = JSON.parse(init?.body ?? '{}').type
    const body = type === 'spotClearinghouseState' ? spot : perps
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = original
})

describe('hyperliquid', () => {
  test('is provably read-only — there is no credential to over-scope', async () => {
    stub()
    expect(await hyperliquidConnector.verifyScope({ address: ADDRESS })).toEqual({
      canRead: true,
      canTrade: false,
      canWithdraw: false,
    })
  })

  test('refuses anything that is not an address, before calling out', async () => {
    stub()
    await expect(hyperliquidConnector.verifyScope({ address: 'my-seed-phrase' })).rejects.toThrow(
      /not an Ethereum address/,
    )
  })

  test('a short position stays negative', async () => {
    stub()
    const btc = (await hyperliquidConnector.fetchPositions({ address: ADDRESS })).find(
      (p) => p.asset === 'BTC',
    )
    expect(btc?.quantity.toString()).toBe('-0.36296')
    expect(btc?.delta.toString()).toBe('-0.36296')
    expect(btc?.liquidation?.price?.toString()).toBe('8334793.0463984795')
    expect(btc?.liquidation?.leverage?.toString()).toBe('20')
  })

  test('a null liquidation price is absent, never zero', async () => {
    stub()
    const atom = (await hyperliquidConnector.fetchPositions({ address: ADDRESS })).find(
      (p) => p.asset === 'ATOM',
    )
    expect(atom).toBeDefined()
    expect(atom?.liquidation).toBeUndefined()
  })

  test('zero-size positions and zero balances are dropped', async () => {
    stub()
    const positions = await hyperliquidConnector.fetchPositions({ address: ADDRESS })
    expect(positions.find((p) => p.asset === 'SOL')).toBeUndefined()
    expect(positions.find((p) => p.asset === 'HYPE')).toBeUndefined()
  })

  test('spot balances and withdrawable margin both land', async () => {
    stub()
    const positions = await hyperliquidConnector.fetchPositions({ address: ADDRESS })
    expect(positions.find((p) => p.asset === 'PURR')?.quantity.toString()).toBe('120.5')
    expect(positions.find((p) => p.asset === 'USDC')?.quantity.toString()).toBe('2500.5')
  })

  test('freshness comes from the venue clock, not ours', async () => {
    stub()
    const positions = await hyperliquidConnector.fetchPositions({ address: ADDRESS })
    for (const p of positions) expect(p.asOf.getTime()).toBe(VENUE_TIME)
  })

  test('an account with nothing open returns nothing', async () => {
    stub({ time: VENUE_TIME, assetPositions: [], withdrawable: '0.0' }, { balances: [] })
    expect(await hyperliquidConnector.fetchPositions({ address: ADDRESS })).toEqual([])
  })
})
