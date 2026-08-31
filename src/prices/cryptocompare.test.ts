import { describe, expect, test } from 'bun:test'
import { CryptoCompareOracle } from './cryptocompare.js'

const respond = (body: unknown, status = 200) =>
  async () => new Response(JSON.stringify(body), { status }) as Response

describe('CryptoCompare', () => {
  test('sends the key as an Authorization header, never in the query string', async () => {
    const seen: { url?: string; auth?: string | null } = {}
    const oracle = new CryptoCompareOracle('secret-key', async (url, init) => {
      seen.url = url
      seen.auth = new Headers(init.headers).get('authorization')
      return new Response(JSON.stringify({ ETH: { USD: 2400 } }))
    })
    await oracle.quoteMany(['ETH'])
    expect(seen.auth).toBe('Apikey secret-key')
    expect(seen.url).not.toContain('secret-key')
  })

  test('reads a price', async () => {
    const oracle = new CryptoCompareOracle('k', respond({ ETH: { USD: 2400 } }))
    expect((await oracle.quote('ETH'))?.price.toString()).toBe('2400')
  })

  test('an error envelope returned with HTTP 200 is still an error', async () => {
    // It answers 200 with Response:"Error", so without this check a rejected
    // key reads as "no prices for anything" rather than as a bad key.
    const oracle = new CryptoCompareOracle(
      'bad',
      respond({ Response: 'Error', Message: 'You are over your rate limit' }),
    )
    expect(oracle.quote('ETH')).rejects.toThrow(/over your rate limit[\s\S]*cryptocompare connect/)
  })

  test('an unknown asset yields no quote rather than a zero', async () => {
    const oracle = new CryptoCompareOracle('k', respond({ ETH: { USD: 2400 } }))
    expect(await oracle.quote('NOTACOIN')).toBeNull()
  })
})
