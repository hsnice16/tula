import { describe, expect, test } from 'bun:test'
import { TulaError } from '../core/errors.js'
import { CoinGeckoOracle } from './coingecko.js'

interface Row {
  id: string
  symbol: string
  current_price: number | null
}

function stub(pages: Row[][], status = 200) {
  const calls: string[] = []
  const oracle = new CoinGeckoOracle(
    async (url) => {
      calls.push(url)
      const page = Number(new URL(url).searchParams.get('page') ?? '1')
      return new Response(JSON.stringify(pages[page - 1] ?? []), { status })
    },
    60_000,
    pages.length,
  )
  return { oracle, calls }
}

const TOP = [
  { id: 'bitcoin', symbol: 'btc', current_price: 60000 },
  { id: 'ethereum', symbol: 'eth', current_price: 4000 },
  { id: 'usd-coin', symbol: 'usdc', current_price: 0.9998 },
]

describe('CoinGeckoOracle', () => {
  test('resolves symbols from market data, case-insensitively', async () => {
    const { oracle } = stub([TOP])
    const quotes = await oracle.quoteMany(['BTC', 'ETH'])
    expect(quotes.get('BTC')?.price.toString()).toBe('60000')
    expect(quotes.get('ETH')?.price.toString()).toBe('4000')
  })

  test('USD is 1 by definition and costs no request', async () => {
    const { oracle, calls } = stub([TOP])
    const quotes = await oracle.quoteMany(['USD'])
    expect(calls).toHaveLength(0)
    expect(quotes.get('USD')?.price.toString()).toBe('1')
  })

  test('a contested ticker resolves to the larger coin', async () => {
    // Market-cap order puts the intended coin first.
    const { oracle } = stub([
      [
        { id: 'real-safe', symbol: 'safe', current_price: 2 },
        { id: 'imposter-safe', symbol: 'safe', current_price: 999 },
      ],
    ])
    expect((await oracle.quoteMany(['SAFE'])).get('SAFE')?.price.toString()).toBe('2')
  })

  test('a pinned symbol ignores ordering entirely', async () => {
    const { oracle } = stub([
      [
        { id: 'not-bitcoin', symbol: 'btc', current_price: 1 },
        { id: 'bitcoin', symbol: 'btc-real', current_price: 60000 },
      ],
    ])
    expect((await oracle.quoteMany(['BTC'])).get('BTC')?.price.toString()).toBe('60000')
  })

  test('an unlisted symbol is absent, never guessed at', async () => {
    const { oracle } = stub([TOP])
    const quotes = await oracle.quoteMany(['NOTACOIN'])
    expect(quotes.has('NOTACOIN')).toBe(false)
    expect(await oracle.quote('NOTACOIN')).toBeNull()
  })

  test('a coin with no price is skipped rather than treated as zero', async () => {
    const { oracle } = stub([[{ id: 'x', symbol: 'xxx', current_price: null }]])
    expect((await oracle.quoteMany(['XXX'])).has('XXX')).toBe(false)
  })

  test('pages are fetched once and reused inside the TTL', async () => {
    const { oracle, calls } = stub([TOP, []])
    await oracle.quoteMany(['BTC'])
    await oracle.quoteMany(['ETH'])
    expect(calls).toHaveLength(2)
  })

  test('a rate limit says prices are gone, not that the portfolio is', async () => {
    const { oracle } = stub([TOP], 429)
    const err = await oracle.quoteMany(['BTC']).catch((e) => e)
    expect(err).toBeInstanceOf(TulaError)
    expect((err as Error).message).toContain('still correct')
  })
})
