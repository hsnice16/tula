import { afterEach, describe, expect, test } from 'bun:test'
import { binanceConnector, sign } from './binance.js'

const CREDS = { apiKey: 'key', apiSecret: 'secret' }
const original = globalThis.fetch

function stub(routes: Record<string, unknown>) {
  globalThis.fetch = (async (url: string) => {
    const match = Object.keys(routes).find((path) => String(url).includes(path))
    if (!match) return new Response(JSON.stringify({ code: -1121, msg: 'no route' }), { status: 400 })
    return new Response(JSON.stringify(routes[match]), { status: 200 })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = original
})

describe('binance signing', () => {
  test('HMAC-SHA256 over the query string, hex encoded', () => {
    // Binance's own documented example.
    const query =
      'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559'
    expect(sign(query, 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j')).toBe(
      'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71',
    )
  })
})

describe('binance scope', () => {
  test('every permission is proven — nothing is unknown here', async () => {
    stub({
      '/sapi/v1/account/apiRestrictions': {
        enableReading: true,
        enableWithdrawals: false,
        enableSpotAndMarginTrading: false,
        enableFutures: false,
      },
    })
    expect(await binanceConnector.verifyScope(CREDS)).toEqual({
      canRead: true,
      canTrade: false,
      canWithdraw: false,
    })
  })

  test('a trade-enabled key reports canTrade true, so connect can refuse it', async () => {
    stub({
      '/sapi/v1/account/apiRestrictions': {
        enableReading: true,
        enableWithdrawals: false,
        enableSpotAndMarginTrading: true,
      },
    })
    expect((await binanceConnector.verifyScope(CREDS)).canTrade).toBe(true)
  })

  test('an API error becomes a message, not a raw response', async () => {
    stub({})
    await expect(binanceConnector.verifyScope(CREDS)).rejects.toThrow(/Binance/)
  })
})

describe('binance positions', () => {
  const SPOT = {
    balances: [
      { asset: 'BTC', free: '0.5', locked: '0.25' },
      { asset: 'ETH', free: '0', locked: '0' },
    ],
  }

  test('free and locked are one holding', async () => {
    stub({ '/api/v3/account': SPOT, '/fapi/v2/positionRisk': [] })
    const positions = await binanceConnector.fetchPositions(CREDS)
    expect(positions.find((p) => p.asset === 'BTC')?.quantity.toString()).toBe('0.75')
    expect(positions.find((p) => p.asset === 'ETH')).toBeUndefined()
  })

  test('a perp symbol resolves to the asset it tracks', async () => {
    stub({
      '/api/v3/account': { balances: [] },
      '/fapi/v2/positionRisk': [
        { symbol: 'ETHUSDT', positionAmt: '-2.5', liquidationPrice: '4200', leverage: '10' },
      ],
    })
    const perp = (await binanceConnector.fetchPositions(CREDS))[0]
    expect(perp?.asset).toBe('ETH')
    expect(perp?.quantity.toString()).toBe('-2.5')
    expect(perp?.liquidation?.price?.toString()).toBe('4200')
  })

  test('a zero liquidation price means none, not imminent', async () => {
    stub({
      '/api/v3/account': { balances: [] },
      '/fapi/v2/positionRisk': [{ symbol: 'BTCUSDT', positionAmt: '1', liquidationPrice: '0' }],
    })
    expect((await binanceConnector.fetchPositions(CREDS))[0]?.liquidation).toBeUndefined()
  })

  test('a spot-only key is not reported as a broken venue', async () => {
    stub({ '/api/v3/account': SPOT })
    const positions = await binanceConnector.fetchPositions(CREDS)
    expect(positions).toHaveLength(1)
  })
})
