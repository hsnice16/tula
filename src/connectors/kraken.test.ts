import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { whatBreaksFirst } from '../core/risk.js'
import { krakenConnector, normalizeAsset, sign } from './kraken.js'

/**
 * Captured from https://api.kraken.com/0/public/Assets on 2026-09-10 — public,
 * no key. A hand-written asset list cannot contradict a wrong belief about
 * Kraken's naming, which is the whole reason the naming was wrong.
 */
const ASSETS = JSON.parse(
  readFileSync(new URL('../../fixtures/kraken/assets.json', import.meta.url), 'utf8'),
) as { result: Record<string, { altname: string; status: string }> }

/** https://api.kraken.com/0/public/AssetPairs?pair=XXBTZUSD,XETHZUSD,SOLUSD,XXBTZEUR */
const PAIRS = JSON.parse(
  readFileSync(new URL('../../fixtures/kraken/asset-pairs.json', import.meta.url), 'utf8'),
) as { result: Record<string, unknown> }

const NAMES = new Map(Object.entries(ASSETS.result).map(([code, info]) => [code, info.altname]))
const CREDS = { apiKey: 'key', apiSecret: Buffer.alloc(32).toString('base64') }
const original = globalThis.fetch

/** Every private path the connector may reach, and what Kraken answers on it. */
interface Book {
  balanceEx?: Record<string, { balance: string; hold_trade?: string; credit?: string; credit_used?: string }>
  balance?: Record<string, Record<string, string>>
  wallets?: Array<{ account_id: string; type: string }>
  positions?: Record<string, unknown>
  denied?: string[]
}

const reached: string[] = []

function stub(book: Book) {
  reached.length = 0
  globalThis.fetch = (async (input: unknown, init?: { body?: URLSearchParams }) => {
    const url = String(input)
    reached.push(url)
    const ok = (result: unknown) => new Response(JSON.stringify({ error: [], result }), { status: 200 })
    const deny = () => new Response(JSON.stringify({ error: ['EGeneral:Permission denied'] }), { status: 200 })

    if (url.includes('/0/public/Assets')) return ok(ASSETS.result)
    if (url.includes('/0/public/AssetPairs')) return ok(PAIRS.result)

    const path = new URL(url).pathname
    if (book.denied?.includes(path)) return deny()

    if (path.endsWith('/ListWalletAccounts')) return ok({ accounts: book.wallets ?? [] })
    if (path.endsWith('/OpenPositions')) return ok(book.positions ?? {})
    if (path.endsWith('/BalanceEx')) return ok(book.balanceEx ?? {})
    if (path.endsWith('/Balance')) {
      const id = init?.body?.get('account_id') ?? ''
      return ok(book.balance?.[id] ?? {})
    }
    if (path.endsWith('/WithdrawMethods')) return deny()
    return new Response(JSON.stringify({ error: ['EGeneral:Unknown method'] }), { status: 200 })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = original
})

describe('sign', () => {
  // Kraken's published worked example. If this drifts, every private call
  // fails as EAPI:Invalid signature, which reads as a bad key instead.
  test('matches the documented vector', () => {
    const body = new URLSearchParams()
    body.set('nonce', '1616492376594')
    body.set('ordertype', 'limit')
    body.set('pair', 'XBTUSD')
    body.set('price', '37500')
    body.set('type', 'buy')
    body.set('volume', '1.25')

    const secret =
      'kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg=='

    expect(sign('/0/private/AddOrder', body, secret)).toBe(
      '4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==',
    )
  })

  test('rejects a secret that is not base64', () => {
    const body = new URLSearchParams({ nonce: '1' })
    expect(() => sign('/0/private/Balance', body, 'not-base64!')).toThrow()
  })
})

describe('normalizeAsset', () => {
  test('reads the legacy prefixes off the codes that actually carry them', () => {
    expect(normalizeAsset('XXBT', NAMES)).toEqual({ asset: 'BTC', kind: 'spot' })
    expect(normalizeAsset('XETH', NAMES)).toEqual({ asset: 'ETH', kind: 'spot' })
    expect(normalizeAsset('ZUSD', NAMES)).toEqual({ asset: 'USD', kind: 'spot' })
    expect(normalizeAsset('XXDG', NAMES)).toEqual({ asset: 'DOGE', kind: 'spot' })
  })

  // Each of these is four characters and starts with X or Z without being
  // prefixed. Named one by one because each was a live, tradeable balance
  // reported under a ticker that is either unpriceable or somebody else's.
  test.each([
    ['XAUT', 'XAUT'],
    ['XION', 'XION'],
    ['XNAP', 'XNAP'],
    ['XTER', 'XTER'],
    ['ZAMA', 'ZAMA'],
    ['ZBCN', 'ZBCN'],
    ['ZETA', 'ZETA'],
    ['ZEUS', 'ZEUS'],
    ['ZORA', 'ZORA'],
  ])('does not rename %s, which only looks prefixed', (code, asset) => {
    expect(normalizeAsset(code, NAMES).asset).toBe(asset)
  })

  test('leaves three-character codes alone', () => {
    expect(normalizeAsset('XRP', NAMES)).toEqual({ asset: 'XRP', kind: 'spot' })
    expect(normalizeAsset('XTZ', NAMES)).toEqual({ asset: 'XTZ', kind: 'spot' })
    expect(normalizeAsset('USDT', NAMES)).toEqual({ asset: 'USDT', kind: 'spot' })
  })

  test('reads yield suffixes as staked', () => {
    expect(normalizeAsset('XTZ.S', NAMES)).toEqual({ asset: 'XTZ', kind: 'staked' })
    expect(normalizeAsset('XBT.M', NAMES)).toEqual({ asset: 'BTC', kind: 'staked' })
    expect(normalizeAsset('DOT.P', NAMES)).toEqual({ asset: 'DOT', kind: 'staked' })
  })

  // .HOLD is fiat under a withdrawal hold. Matching on the first letter of the
  // suffix read it as spot and merged it into the freely spendable row.
  test('reads a withdrawal hold as money that cannot be moved', () => {
    expect(normalizeAsset('USD.HOLD', NAMES)).toEqual({ asset: 'USD', kind: 'pending' })
    expect(normalizeAsset('EUR.HOLD', NAMES)).toEqual({ asset: 'EUR', kind: 'pending' })
  })

  test('a chain variant is the asset it is a variant of', () => {
    expect(normalizeAsset('ETH.INK', NAMES)).toEqual({ asset: 'ETH', kind: 'spot' })
    expect(normalizeAsset('HYPER.CORE', NAMES)).toEqual({ asset: 'HYPER', kind: 'spot' })
  })

  test('two live assets never resolve to one ticker', () => {
    const seen = new Map<string, string>()
    for (const [code, info] of Object.entries(ASSETS.result)) {
      if (info.status !== 'enabled') continue
      const { asset, kind } = normalizeAsset(code, NAMES)
      const key = `${kind}:${asset}`
      const first = seen.get(key)
      // Yield and hold variants are one exposure with the asset they earn on;
      // two *different* assets landing on one ticker is a merged balance.
      if (first !== undefined && !first.includes('.') && !code.includes('.')) {
        throw new Error(`${code} and ${first} both normalize to ${key}`)
      }
      if (first === undefined) seen.set(key, code)
    }
    expect(seen.get('spot:BTC')).toBe('XXBT')
  })

  test('an asset the list did not carry still loses a real prefix', () => {
    expect(normalizeAsset('XXBT')).toEqual({ asset: 'BTC', kind: 'spot' })
    expect(normalizeAsset('XTZ')).toEqual({ asset: 'XTZ', kind: 'spot' })
  })
})

describe('kraken scope', () => {
  test('a key that cannot read positions is refused with the permission to add', async () => {
    stub({ denied: ['/0/private/OpenPositions'] })
    await expect(krakenConnector.verifyScope(CREDS)).rejects.toThrow(/Query open orders & trades/)
  })

  test('a query-only key reads, cannot withdraw, and trade stays unproven', async () => {
    stub({})
    expect(await krakenConnector.verifyScope(CREDS)).toEqual({
      canRead: true,
      canTrade: 'unknown',
      canWithdraw: false,
    })
  })
})

describe('kraken balances', () => {
  test('a wallet the account list names is not left out of the book', async () => {
    stub({
      wallets: [
        { account_id: 'w-main', type: 'main' },
        { account_id: 'w-spot', type: 'spot' },
      ],
      balance: {
        'w-main': { ZUSD: '1000.0000' },
        'w-spot': { XXBT: '0.5' },
      },
    })
    const positions = await krakenConnector.fetchPositions(CREDS)
    expect(positions.map((p) => `${p.venue}:${p.asset}`).sort()).toEqual([
      'kraken-main:USD',
      'kraken-spot:BTC',
    ])
  })

  test('held funds are their own row, not part of what you can move', async () => {
    stub({ balanceEx: { ZUSD: { balance: '1000', hold_trade: '250' } } })
    const positions = await krakenConnector.fetchPositions(CREDS)
    expect(positions.find((p) => p.kind === 'spot')?.quantity.toString()).toBe('750')
    expect(positions.find((p) => p.kind === 'pending')?.quantity.toString()).toBe('250')
  })

  // Kraken's holds cover spot non-margin orders only, so beside a margin book
  // the free figure is not merely absent — it is too high.
  test('the free figure is withheld once a margin position encumbers it', async () => {
    stub({
      balanceEx: { ZUSD: { balance: '1000', hold_trade: '250' } },
      positions: {
        TX1: { pair: 'XXBTZUSD', type: 'buy', vol: '1', vol_closed: '0', cost: '50000', margin: '10000' },
      },
    })
    const positions = await krakenConnector.fetchPositions(CREDS)
    const usd = positions.filter((p) => p.venue === 'kraken' && p.asset === 'USD')
    expect(usd.map((p) => p.kind)).toEqual(['spot'])
    expect(usd[0]?.quantity.toString()).toBe('1000')
  })

  test('a zero balance is not a row', async () => {
    stub({ balanceEx: { ZUSD: { balance: '0.0000' } } })
    expect(await krakenConnector.fetchPositions(CREDS)).toEqual([])
  })
})

describe('kraken margin positions', () => {
  const LONG = {
    TX1: { pair: 'XXBTZUSD', type: 'buy', vol: '1.0', vol_closed: '0', cost: '50000', margin: '10000' },
  }

  test('a 5x long is exposure to the asset, not an empty account', async () => {
    stub({ positions: LONG })
    const positions = await krakenConnector.fetchPositions(CREDS)
    const btc = positions.find((p) => p.asset === 'BTC')
    expect(btc?.quantity.toString()).toBe('1')
    expect(btc?.kind).toBe('collateral')
  })

  test('the loan that paid for a long is not left out of the total', async () => {
    stub({ positions: LONG })
    const usd = (await krakenConnector.fetchPositions(CREDS)).find((p) => p.asset === 'USD')
    expect(usd?.kind).toBe('debt')
    expect(usd?.quantity.toString()).toBe('-50000')
  })

  test('a short is negative in the asset and long the proceeds', async () => {
    stub({
      positions: {
        TX2: { pair: 'XETHZUSD', type: 'sell', vol: '10', vol_closed: '0', cost: '30000', margin: '6000' },
      },
    })
    const positions = await krakenConnector.fetchPositions(CREDS)
    expect(positions.find((p) => p.asset === 'ETH')?.quantity.toString()).toBe('-10')
    expect(positions.find((p) => p.asset === 'USD')?.quantity.toString()).toBe('30000')
  })

  test('a partly closed position counts only what is still open', async () => {
    stub({
      positions: {
        TX3: { pair: 'SOLUSD', type: 'buy', vol: '100', vol_closed: '40', cost: '12000', margin: '3000' },
      },
    })
    const sol = (await krakenConnector.fetchPositions(CREDS)).find((p) => p.asset === 'SOL')
    expect(sol?.quantity.toString()).toBe('60')
  })

  // The defect this whole endpoint closes: a leveraged book answering "nothing
  // can be liquidated" because no row carried anything to rank.
  test('a margin position reaches what breaks first rather than being omitted', async () => {
    stub({ positions: LONG })
    const positions = await krakenConnector.fetchPositions(CREDS)
    const ranked = whatBreaksFirst(positions, new Map())
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.position.asset).toBe('BTC')
    expect(ranked[0]?.position.liquidation?.leverage?.toString()).toBe('5')
    // Unknown, not safe: Kraken publishes no liquidation price for it.
    expect(ranked[0]?.move).toBeNull()
  })

  test('a key that lost the positions permission fails loudly instead of reading zero', async () => {
    stub({ denied: ['/0/private/OpenPositions'], balanceEx: { XXBT: { balance: '1' } } })
    await expect(krakenConnector.fetchPositions(CREDS)).rejects.toThrow(/Query open orders & trades/)
  })

  test('a pair the public list does not describe fails rather than guessing the asset', async () => {
    stub({ positions: { TX4: { pair: 'NOPEUSD', type: 'buy', vol: '1', cost: '1', margin: '1' } } })
    await expect(krakenConnector.fetchPositions(CREDS)).rejects.toThrow(/Unknown pair/)
  })
})

// These hold the coverage declaration honest in the direction nobody watches:
// they fail when a gap is closed, so the line claiming tula does not read it
// has to be deleted in the same change. Written to be broken by progress.
describe('kraken declared gaps', () => {
  test('every gap is worded as something, for a reason, hiding one thing', () => {
    for (const gap of krakenConnector.coverage?.doesNotRead ?? []) {
      expect(gap.what.length).toBeGreaterThan(0)
      expect(gap.why.length).toBeGreaterThan(0)
      expect(['value', 'liquidation', 'availability']).toContain(gap.hides)
    }
  })

  test('the account margin level is still unread — delete the gap when it is', async () => {
    stub({ positions: { TX1: { pair: 'XXBTZUSD', type: 'buy', vol: '1', cost: '50000', margin: '10000' } } })
    await krakenConnector.fetchPositions(CREDS)
    expect(reached.some((url) => url.includes('TradeBalance'))).toBe(false)
  })

  test('Kraken Futures is still unread — delete the gap when it is', async () => {
    stub({ balanceEx: { XXBT: { balance: '1' } } })
    await krakenConnector.fetchPositions(CREDS)
    expect(reached.some((url) => url.includes('futures.kraken.com'))).toBe(false)
  })

  /**
   * The other two gaps here are proven by an endpoint nobody called. This one
   * is not: `credit` and `credit_used` arrive on the BalanceEx row the
   * connector already reads, so nothing about the traffic says whether they
   * were used. What says it is the book: a drawn line read as the liability it
   * is adds a debt leg, and read as spendable it inflates the balance.
   */
  test('a drawn credit line is still unread — delete the gap when the debt leg appears', async () => {
    expect(
      (krakenConnector.coverage?.doesNotRead ?? []).some((g) => g.what.includes('drawn credit lines')),
    ).toBe(true)
    stub({ balanceEx: { ZUSD: { balance: '1000', credit: '5000', credit_used: '2000' } } })
    const positions = await krakenConnector.fetchPositions(CREDS)
    expect(positions.map((p) => `${p.kind} ${p.asset} ${p.quantity.toString()}`)).toEqual([
      'spot USD 1000',
    ])
  })
})
