import { describe, expect, test } from 'bun:test'
import { CoinMarketCapOracle } from './coinmarketcap.js'

const respond = (body: unknown, status = 200) =>
  async () => new Response(JSON.stringify(body), { status }) as Response

describe('CoinMarketCap', () => {
  test('sends the key as a header, never in the query string', async () => {
    const seen: { url?: string; key?: string | null } = {}
    const oracle = new CoinMarketCapOracle('secret-key', async (url, init) => {
      seen.url = url
      seen.key = new Headers(init.headers).get('X-CMC_PRO_API_KEY')
      return new Response(JSON.stringify({ data: {} }))
    })
    await oracle.quoteMany(['ETH'])
    expect(seen.key).toBe('secret-key')
    expect(seen.url).not.toContain('secret-key')
  })

  test('the first entry wins a contested ticker, since the list is ranked', async () => {
    const oracle = new CoinMarketCapOracle(
      'k',
      respond({
        data: {
          ETH: [
            { symbol: 'ETH', quote: { USD: { price: 2400, last_updated: '2026-08-31T06:00:00Z' } } },
            { symbol: 'ETH', quote: { USD: { price: 3 } } },
          ],
        },
      }),
    )
    const quote = await oracle.quote('ETH')
    expect(quote?.price.toString()).toBe('2400')
    expect(quote?.asOf.toISOString()).toBe('2026-08-31T06:00:00.000Z')
  })

  test('a rejected key names the command that replaces it', async () => {
    const oracle = new CoinMarketCapOracle('bad', respond({}, 401))
    expect(oracle.quote('ETH')).rejects.toThrow(/\/coinmarketcap connect/)
  })

  test('USD costs no request', async () => {
    let called = false
    const oracle = new CoinMarketCapOracle('k', async () => {
      called = true
      return new Response('{}')
    })
    expect((await oracle.quoteMany(['USD'])).get('USD')?.price.toString()).toBe('1')
    expect(called).toBe(false)
  })
})
