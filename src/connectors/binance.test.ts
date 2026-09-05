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
    // -2015 is what Binance answers a key that may not read futures.
    globalThis.fetch = (async (url: string) => {
      const spot = String(url).includes('/api/v3/account')
      return new Response(
        JSON.stringify(spot ? SPOT : { code: -2015, msg: 'Invalid API-key, IP, or permissions' }),
        { status: spot ? 200 : 401 },
      )
    }) as unknown as typeof fetch
    const positions = await binanceConnector.fetchPositions(CREDS)
    expect(positions).toHaveLength(1)
  })

  // The catch above this exists for the permission-less key, and used to take
  // everything: a futures leg that timed out or answered 5xx loaded the account
  // as spot-only with no failure to report, which is a book with open perps in
  // it answering "nothing can be liquidated".
  test('a futures leg that fails for any other reason is not silently dropped', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/api/v3/account')) {
        return new Response(JSON.stringify(SPOT), { status: 200 })
      }
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(binanceConnector.fetchPositions(CREDS)).rejects.toThrow(/fetch failed/)
  })

  // Both shapes a bad gateway takes: an HTML page, which is not JSON at all, and
  // a JSON envelope carrying no Binance code. Neither is a permission answer.
  test('a 5xx error page from the futures host is not read as a spot-only account', async () => {
    globalThis.fetch = (async (url: string) => {
      const spot = String(url).includes('/api/v3/account')
      return new Response(spot ? JSON.stringify(SPOT) : '<html>bad gateway</html>', {
        status: spot ? 200 : 502,
      })
    }) as unknown as typeof fetch
    expect(binanceConnector.fetchPositions(CREDS)).rejects.toThrow(/HTTP 502/)
  })

  test('a 5xx with a JSON body from the futures host is not read as spot-only', async () => {
    globalThis.fetch = (async (url: string) => {
      const spot = String(url).includes('/api/v3/account')
      return new Response(JSON.stringify(spot ? SPOT : { msg: 'Service unavailable' }), {
        status: spot ? 200 : 503,
      })
    }) as unknown as typeof fetch
    expect(binanceConnector.fetchPositions(CREDS)).rejects.toThrow(/Service unavailable/)
  })
})
