import { afterEach, describe, expect, test } from 'bun:test'
import { aaveConnector } from './aave.js'

const CORE = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'
const PRIME = '0x4e033931ad43597d96D6bcc25c280717730B58B1'
const ETHERFI = '0x0AA97c284e98396202b6A04024F5E2c65026F3c0'
const HORIZON = '0xAe05Cd22df81871bc7cC2a04BeCfb516bFe332C8'

const ADDRESS = '0x0000000000000000000000000000000000000abc'
const CREDS = { address: ADDRESS }

/**
 * Built rather than written out: a 40-hex literal in a test file is
 * indistinguishable from a real holding to `scan-staged`, and allowlisting a
 * placeholder would claim it was a public contract.
 */
const fake = (tag: string): string => `0x${tag.padStart(40, '0')}`

const word = (n: bigint): string => n.toString(16).padStart(64, '0')
const addressWord = (a: string): string => a.replace(/^0x/, '').toLowerCase().padStart(64, '0')
const MAX_UINT = (1n << 256n) - 1n

/** ABI dynamic string: offset, length, then the bytes. */
function stringReturn(text: string): string {
  const hex = Buffer.from(text, 'utf8').toString('hex')
  return '0x' + word(32n) + word(BigInt(text.length)) + hex.padEnd(64, '0')
}

/** getUserAccountData: collateral, debt, borrowable, threshold, ltv, health. */
function accountReturn(collateral: bigint, debt: bigint, health: bigint): string {
  return '0x' + [collateral, debt, 0n, 8000n, 7500n, health].map(word).join('')
}

/** getReserveData, of which only [8] aToken and [10] variableDebtToken are read. */
function reserveDataReturn(aToken: string, debtToken: string): string {
  const slots = Array.from({ length: 15 }, () => word(0n))
  slots[8] = addressWord(aToken)
  slots[10] = addressWord(debtToken)
  return '0x' + slots.join('')
}

interface Market {
  underlying: string
  aToken: string
  debtToken: string
  symbol: string
  decimals: bigint
  supplied: bigint
  borrowed: bigint
  account: string
}

/**
 * Two markets the account is in and two it is not, which is the ordinary shape:
 * almost nobody supplies to all four, and reading one of them was the defect.
 */
const MARKETS: Record<string, Market> = {
  [CORE.toLowerCase()]: {
    underlying: fake('c1'),
    aToken: fake('a1'),
    debtToken: fake('d1'),
    symbol: 'USDC',
    decimals: 6n,
    supplied: 1000n * 10n ** 6n,
    borrowed: 500n * 10n ** 6n,
    account: accountReturn(1000n * 10n ** 8n, 500n * 10n ** 8n, 15n * 10n ** 17n),
  },
  [PRIME.toLowerCase()]: {
    underlying: fake('c2'),
    aToken: fake('a2'),
    debtToken: fake('d2'),
    symbol: 'WETH',
    decimals: 18n,
    supplied: 2n * 10n ** 18n,
    borrowed: 0n,
    account: accountReturn(2n * 10n ** 8n, 0n, MAX_UINT),
  },
}

const EMPTY_ACCOUNT = accountReturn(0n, 0n, MAX_UINT)

const original = globalThis.fetch

/** Pools the account read actually went out to, in call order. */
let asked: string[] = []

/**
 * `dead` names a pool whose account read answers with an error, not a zero;
 * `short` names one that answers successfully but with too few words.
 */
function stubNode(dead: string | null = null, short: string | null = null): void {
  asked = []
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    const calls = JSON.parse(init?.body ?? '[]') as Array<{
      id: number
      params: [{ to: string; data: string }, string]
    }>
    const out = calls.map(({ id, params }) => {
      const to = params[0].to.toLowerCase()
      const data = params[0].data
      const selector = data.slice(0, 10)
      const market = MARKETS[to]

      if (selector === '0xbf92857c') {
        asked.push(to)
        if (dead && to === dead.toLowerCase()) {
          return { id, error: { message: 'execution reverted' } }
        }
        if (short && to === short.toLowerCase()) return { id, result: '0x' }
        return { id, result: market ? market.account : EMPTY_ACCOUNT }
      }
      if (selector === '0xd1946dbc' && market) {
        return { id, result: '0x' + word(32n) + word(1n) + addressWord(market.underlying) }
      }
      if (selector === '0x35ea6a75' && market) {
        return { id, result: reserveDataReturn(market.aToken, market.debtToken) }
      }

      const owner = Object.values(MARKETS).find(
        (m) => m.underlying === to || m.aToken === to || m.debtToken === to,
      )
      if (owner) {
        if (selector === '0x95d89b41') return { id, result: stringReturn(owner.symbol) }
        if (selector === '0x313ce567') return { id, result: '0x' + word(owner.decimals) }
        if (selector === '0x70a08231') {
          const balance = owner.aToken === to ? owner.supplied : owner.borrowed
          return { id, result: '0x' + word(balance) }
        }
      }
      return { id, result: '0x' + word(0n) }
    })
    return new Response(JSON.stringify(out), { status: 200 })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = original
})

describe('aave across every market on the chain', () => {
  test('collateral supplied to a second market is not missing because the first answered', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    const prime = positions.find((p) => p.venue === 'aave-prime' && p.kind === 'collateral')
    expect(prime).toBeDefined()
    expect(prime?.quantity.toString()).toBe('2')
  })

  test('the market almost every account is in keeps the bare venue id', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    const core = positions.find((p) => p.id === 'aave:collateral:USDC')
    expect(core).toBeDefined()
    expect(core?.venue).toBe('aave')
    expect(core?.quantity.toString()).toBe('1000')
  })

  test('every market on the chain is asked, not only the first', async () => {
    stubNode()
    await aaveConnector.fetchPositions(CREDS)
    for (const pool of [CORE, PRIME, ETHERFI, HORIZON]) {
      expect(asked).toContain(pool.toLowerCase())
    }
  })

  test('a market the account is not in contributes no rows', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    expect(positions.some((p) => p.venue.includes('etherfi'))).toBe(false)
    expect(positions.some((p) => p.venue.includes('horizon'))).toBe(false)
  })

  test('a debt secures only the market it was borrowed in', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    const debt = positions.find((p) => p.kind === 'debt')
    // Pointing at another market's collateral would claim a liquidation
    // relationship that does not exist.
    expect(debt?.encumbers).toEqual(['aave:collateral:USDC'])
  })

  test('each market carries its own health factor, not the first one found', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    const core = positions.find((p) => p.id === 'aave:collateral:USDC')
    const prime = positions.find((p) => p.venue === 'aave-prime')
    expect(core?.liquidation?.healthFactor?.toString()).toBe('1.5')
    // No debt in that market, so max-uint, which is not a health factor.
    expect(prime?.liquidation).toBeUndefined()
  })

  test('WETH nets as ETH wherever the market reports it', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    expect(positions.find((p) => p.venue === 'aave-prime')?.asset).toBe('ETH')
  })

  test('a market that answers short fails rather than reading as holding nothing', async () => {
    // An address with no code answers `0x` successfully, so nothing is null and
    // the market would simply be skipped — an empty book with no INCOMPLETE,
    // which is the defect the four-market read exists to close.
    stubNode(null, PRIME)
    await expect(aaveConnector.fetchPositions(CREDS)).rejects.toThrow(/unreadable/)
  })

  test('a truncated answer never renders as a health factor of zero', async () => {
    // Reading word [5] off a short answer gives 0, and 0 is not "no debt" — it
    // is the number that marks every collateral leg liquidatable now.
    stubNode(null, CORE)
    await expect(aaveConnector.fetchPositions(CREDS)).rejects.toThrow(/Core/)
  })

  test('a market that does not answer fails the venue rather than reading as empty', async () => {
    stubNode(PRIME)
    // Reported as nothing supplied, this is the same silent shortfall the
    // four-market read exists to close.
    await expect(aaveConnector.fetchPositions(CREDS)).rejects.toThrow(/Prime/)
  })
})
