import { afterEach, describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import { readFileSync } from 'node:fs'
import { whatBreaksFirst } from '../core/risk.js'
import { binanceConnector, contractAsset, sign } from './binance.js'

/**
 * Built from Binance's own documented response examples — a key is required, so
 * neither could be captured. Each fixture names the page it was built from.
 */
const ACCOUNT = JSON.parse(
  readFileSync(new URL('../../fixtures/binance/spot-account.json', import.meta.url), 'utf8'),
) as { balances: Array<{ asset: string; free: string; locked: string }> }

const ISOLATED = JSON.parse(
  readFileSync(new URL('../../fixtures/binance/isolated-margin.json', import.meta.url), 'utf8'),
) as unknown

const CREDS = { apiKey: 'key', apiSecret: 'secret' }
const original = globalThis.fetch

function stub(routes: Record<string, unknown>) {
  globalThis.fetch = (async (url: string) => {
    const match = Object.keys(routes).find((path) => String(url).includes(path))
    if (match) return new Response(JSON.stringify(routes[match]), { status: 200 })
    // A test that says nothing about margin is a test about something else.
    if (String(url).includes('/margin/')) {
      return new Response(JSON.stringify({ assets: [], userAssets: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({ code: -1121, msg: 'no route' }), { status: 400 })
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
      canMoveFunds: false,
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
  const SPOT = ACCOUNT

  // Held and free are both exposure and only one of them can be moved; summing
  // them was right about the first and destroyed the answer to the second.
  test('locked balance is its own row, not folded into what you can move', async () => {
    stub({ '/api/v3/account': SPOT, '/fapi/v2/positionRisk': [] })
    const positions = await binanceConnector.fetchPositions(CREDS)
    const btc = positions.filter((p) => p.asset === 'BTC')
    expect(btc.find((p) => p.kind === 'spot')?.quantity.toString()).toBe('0.5')
    expect(btc.find((p) => p.kind === 'pending')?.quantity.toString()).toBe('0.25')
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
    expect(positions.every((p) => p.venue === 'binance')).toBe(true)
    expect(positions.some((p) => p.kind === 'perp')).toBe(false)
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

describe('binance move-funds permissions', () => {
  // Each of these is a write power Binance does not call trading, so the
  // generic over-scope check let a key holding one through as read-only.
  test.each([
    ['enableMargin', 'Enable Margin Loan, Repay & Transfer'],
    ['enableInternalTransfer', 'Enable Internal Transfer'],
    ['permitsUniversalTransfer', 'Permits Universal Transfer'],
  ])('%s is refused, and the refusal names the box to untick', async (flag, label) => {
    stub({
      '/sapi/v1/account/apiRestrictions': {
        enableReading: true,
        enableWithdrawals: false,
        enableSpotAndMarginTrading: false,
        enableFutures: false,
        [flag]: true,
      },
    })
    await expect(binanceConnector.verifyScope(CREDS)).rejects.toThrow(label)
  })

  test('a reading-only key proves it cannot move funds either', async () => {
    stub({
      '/sapi/v1/account/apiRestrictions': {
        enableReading: true,
        enableWithdrawals: false,
        enableSpotAndMarginTrading: false,
        enableFutures: false,
        enableMargin: false,
        enableInternalTransfer: false,
        permitsUniversalTransfer: false,
      },
    })
    expect((await binanceConnector.verifyScope(CREDS)).canMoveFunds).toBe(false)
  })
})

describe('binance contract symbols', () => {
  // A quarterly used to keep its settlement date as part of the asset, so a BTC
  // book split across a perp and two quarterlies netted as three assets.
  test('a quarterly nets against the asset it settles in', () => {
    expect(contractAsset('BTCUSDT_250926')).toBe('BTC')
    expect(contractAsset('ETHUSDT_250627')).toBe('ETH')
  })

  test('a perpetual is the same asset by either spelling', () => {
    expect(contractAsset('BTCUSDT')).toBe('BTC')
    expect(contractAsset('BTCUSD_PERP')).toBe('BTC')
  })

  test('a stablecoin-quoted pair keeps the asset, not the quote', () => {
    expect(contractAsset('SOLFDUSD')).toBe('SOL')
    expect(contractAsset('XRPUSDC')).toBe('XRP')
  })

  test('a quarterly reaches what breaks first under the asset it tracks', async () => {
    stub({
      '/api/v3/account': { balances: [] },
      '/fapi/v2/positionRisk': [
        { symbol: 'BTCUSDT_250926', positionAmt: '2', liquidationPrice: '48000', leverage: '4' },
      ],
    })
    const positions = await binanceConnector.fetchPositions(CREDS)
    expect(positions[0]?.asset).toBe('BTC')
    expect(whatBreaksFirst(positions, new Map([['BTC', new Decimal(60000)]]))).toHaveLength(1)
  })
})

describe('binance margin', () => {
  test('an isolated pair carries the liquidation price Binance published', async () => {
    stub({
      '/api/v3/account': { balances: [] },
      '/fapi/v2/positionRisk': [],
      '/sapi/v1/margin/isolated/account': ISOLATED,
      '/sapi/v1/margin/account': { userAssets: [] },
    })
    const positions = await binanceConnector.fetchPositions(CREDS)
    const btc = positions.find((p) => p.asset === 'BTC')
    expect(btc?.quantity.toString()).toBe('1.5')
    expect(btc?.liquidation?.price?.toString()).toBe('29500')
  })

  test('the loan against an isolated pair is a debt, not a missing row', async () => {
    stub({
      '/api/v3/account': { balances: [] },
      '/fapi/v2/positionRisk': [],
      '/sapi/v1/margin/isolated/account': ISOLATED,
      '/sapi/v1/margin/account': { userAssets: [] },
    })
    const usdt = (await binanceConnector.fetchPositions(CREDS)).find((p) => p.asset === 'USDT')
    expect(usdt?.kind).toBe('debt')
    expect(usdt?.quantity.toString()).toBe('-40012')
  })

  test('a cross-margin borrow is ranked as unknown rather than left out', async () => {
    stub({
      '/api/v3/account': { balances: [] },
      '/fapi/v2/positionRisk': [],
      '/sapi/v1/margin/isolated/account': { assets: [] },
      '/sapi/v1/margin/account': {
        marginLevel: '1.42',
        userAssets: [
          { asset: 'BTC', netAsset: '2.0' },
          { asset: 'USDT', netAsset: '-60000' },
        ],
      },
    })
    const positions = await binanceConnector.fetchPositions(CREDS)
    expect(positions.map((p) => p.kind).sort()).toEqual(['collateral', 'debt'])
    expect(whatBreaksFirst(positions, new Map())).toHaveLength(2)
  })

  // Whether reading margin needs the borrow permission is undocumented, so the
  // call is made; a permission refusal has to read as no margin, not as failure.
  test('a key Binance will not let read margin is not a broken venue', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/margin/')) {
        return new Response(JSON.stringify({ code: -2015, msg: 'Invalid API-key' }), { status: 401 })
      }
      const spot = String(url).includes('/api/v3/account')
      return new Response(JSON.stringify(spot ? ACCOUNT : []), { status: 200 })
    }) as unknown as typeof fetch
    const positions = await binanceConnector.fetchPositions(CREDS)
    expect(positions.some((p) => p.venue === 'binance-margin')).toBe(false)
    expect(positions.some((p) => p.asset === 'BTC')).toBe(true)
  })

  test('a margin leg that fails for any other reason is not silently dropped', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/margin/')) return new Response('<html>bad gateway</html>', { status: 502 })
      const spot = String(url).includes('/api/v3/account')
      return new Response(JSON.stringify(spot ? ACCOUNT : []), { status: 200 })
    }) as unknown as typeof fetch
    await expect(binanceConnector.fetchPositions(CREDS)).rejects.toThrow(/HTTP 502/)
  })
})

// Written to be broken by progress: closing one of these fails its test, so the
// line claiming tula does not read it has to go in the same change.
describe('binance declared gaps', () => {
  test('COIN-M futures and Portfolio Margin are still unread', async () => {
    const reached: string[] = []
    globalThis.fetch = (async (url: string) => {
      reached.push(String(url))
      if (String(url).includes('/api/v3/account')) return new Response(JSON.stringify(ACCOUNT), { status: 200 })
      if (String(url).includes('/margin/')) {
        return new Response(JSON.stringify({ assets: [], userAssets: [] }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }) as unknown as typeof fetch
    await binanceConnector.fetchPositions(CREDS)
    expect(reached.some((url) => url.includes('dapi.binance.com') || url.includes('/papi/'))).toBe(false)
  })

  test('the funding wallet, Simple Earn, staking and loans are still unread', async () => {
    const reached: string[] = []
    globalThis.fetch = (async (url: string) => {
      reached.push(String(url))
      if (String(url).includes('/api/v3/account')) return new Response(JSON.stringify(ACCOUNT), { status: 200 })
      if (String(url).includes('/margin/')) {
        return new Response(JSON.stringify({ assets: [], userAssets: [] }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }) as unknown as typeof fetch
    await binanceConnector.fetchPositions(CREDS)
    for (const path of ['get-funding-asset', 'simple-earn', 'eth-staking', 'sol-staking', '/loan/', 'getUserAsset', 'sub-account']) {
      expect(reached.some((url) => url.includes(path))).toBe(false)
    }
  })

  /**
   * `marginLevel` arrives on the cross-margin response the connector already
   * reads, so no unreached endpoint proves this gap — the rows do. Cross legs
   * carry an empty `liquidation`, which is what ranks them as unknown rather
   * than dropping them; the moment the level is read they carry a health factor
   * or a price, and this fails.
   */
  test('the cross-margin liquidation level is still unread — delete the gap when a cross row states one', async () => {
    expect(
      (binanceConnector.coverage?.doesNotRead ?? []).some((g) =>
        g.what.includes('the margin level a cross-margin account is liquidated at'),
      ),
    ).toBe(true)
    stub({
      '/api/v3/account': { balances: [] },
      '/fapi/v2/positionRisk': [],
      '/sapi/v1/margin/isolated/account': { assets: [] },
      '/sapi/v1/margin/account': {
        marginLevel: '1.42',
        userAssets: [
          { asset: 'BTC', netAsset: '2.0' },
          { asset: 'USDT', netAsset: '-60000' },
        ],
      },
    })
    const cross = (await binanceConnector.fetchPositions(CREDS)).filter((p) => p.id.includes(':cross:'))
    expect(cross).toHaveLength(2)
    for (const p of cross) expect(Object.keys(p.liquidation ?? {})).toEqual([])
  })
})
