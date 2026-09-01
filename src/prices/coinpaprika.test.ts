import { describe, expect, test } from 'bun:test'
import { bestBySymbol, CoinPaprikaOracle, type Ticker } from './coinpaprika.js'

const ticker = (over: Partial<Ticker> & { symbol: string }): Ticker => ({
  rank: 1,
  quotes: { USD: { price: 1 } },
  ...over,
})

const respond = (body: unknown, status = 200) =>
  async () => new Response(JSON.stringify(body), { status }) as Response

describe('symbol collisions', () => {
  test('the higher-ranked coin wins a contested ticker', () => {
    const best = bestBySymbol([
      ticker({ symbol: 'ETH', rank: 74, quotes: { USD: { price: 3 } } }),
      ticker({ symbol: 'ETH', rank: 2, quotes: { USD: { price: 2400 } } }),
    ])
    expect(best.get('ETH')?.quotes?.USD?.price).toBe(2400)
  })

  test('an unranked coin loses to any ranked one, whichever arrives first', () => {
    const best = bestBySymbol([
      ticker({ symbol: 'BTC', rank: 0, quotes: { USD: { price: 0.01 } } }),
      ticker({ symbol: 'BTC', rank: 1, quotes: { USD: { price: 60000 } } }),
    ])
    expect(best.get('BTC')?.quotes?.USD?.price).toBe(60000)
  })

  test('a coin with no USD price is not a candidate at all', () => {
    expect(bestBySymbol([ticker({ symbol: 'X', quotes: {} })]).has('X')).toBe(false)
  })
})

describe('quoting', () => {
  test('USD is 1 by definition and costs no request', async () => {
    let called = false
    const oracle = new CoinPaprikaOracle(async () => {
      called = true
      return new Response('[]')
    })
    const out = await oracle.quoteMany(['USD'])
    expect(out.get('USD')?.price.toString()).toBe('1')
    expect(called).toBe(false)
  })

  test('freshness comes from the coin’s own last print, not receipt time', async () => {
    const oracle = new CoinPaprikaOracle(
      respond([
        ticker({ symbol: 'ETH', quotes: { USD: { price: 2400 } }, last_updated: '2026-08-31T06:48:15Z' }),
      ]),
    )
    const quote = await oracle.quote('ETH')
    expect(quote?.asOf.toISOString()).toBe('2026-08-31T06:48:15.000Z')
  })

  test('an unknown asset yields no quote rather than a zero', async () => {
    const oracle = new CoinPaprikaOracle(respond([ticker({ symbol: 'ETH' })]))
    expect(await oracle.quote('NOTACOIN')).toBeNull()
  })

  test('a rate limit says prices are gone and quantities are not', async () => {
    const oracle = new CoinPaprikaOracle(respond({}, 429))
    expect(oracle.quote('ETH')).rejects.toThrow(/rate limit.*quantities are still correct/s)
  })
})
