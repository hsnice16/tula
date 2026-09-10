import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { aaveConnector, DEPLOYMENTS, reserveConfig, usedAsCollateral } from './aave.js'
import { CHAINS, type ChainId, resetRotation } from './chains.js'
import { PartialRead } from './types.js'

/**
 * Taken from the connector rather than retyped. What proves these addresses are
 * right is the captured reserve list at the bottom of this file, which came off
 * the chain itself; a literal here would only be the build's own claim written
 * out twice.
 */
const poolOf = (chain: ChainId, market: string): string =>
  DEPLOYMENTS.find((d) => d.chain === chain && d.market === market)!.pool

const ARBITRUM = poolOf('arbitrum', 'Core')
const BASE = poolOf('base', 'Core')

const CORE = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'
const PRIME = '0x4e033931ad43597d96D6bcc25c280717730B58B1'
const ETHERFI = '0x0AA97c284e98396202b6A04024F5E2c65026F3c0'
const HORIZON = '0xAe05Cd22df81871bc7cC2a04BeCfb516bFe332C8'

/**
 * Aave V4 on Ethereum, from the official address book. Read by nothing here,
 * and held open by a test below so that stays true only for as long as the
 * connector still says so.
 */
const V4_HUBS = [
  '0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9',
  '0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931',
  '0x06002e9c4412CB7814a791eA3666D905871E536A',
]

/** The Safety Module's staked AAVE, from Aave's own address book. Called by nothing here. */
const STK_AAVE = '0x4da27a545c0c5B758a6BA100e3a049001de870f5'

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

/** ReserveConfigurationMap: LTV in bits 0-15, liquidation threshold in 16-31. */
const configWord = (ltvBps: bigint, thresholdBps: bigint): bigint => (thresholdBps << 16n) | ltvBps

/** getReserveData: [0] configuration, [7] id, [8] aToken, [9] stableDebt, [10] variableDebt. */
function reserveDataReturn(r: Reserve): string {
  const slots = Array.from({ length: 15 }, () => word(0n))
  slots[0] = word(configWord(r.ltv, r.threshold))
  slots[7] = word(BigInt(r.id))
  slots[8] = addressWord(r.aToken)
  slots[9] = addressWord(r.stableDebtToken)
  slots[10] = addressWord(r.debtToken)
  return '0x' + slots.join('')
}

interface Reserve {
  id: number
  underlying: string
  aToken: string
  debtToken: string
  stableDebtToken: string
  symbol: string
  decimals: bigint
  supplied: bigint
  borrowed: bigint
  ltv: bigint
  threshold: bigint
}

interface Market {
  reserves: Reserve[]
  /** The user's collateral/borrow bitmap, two bits per reserve id. */
  config: bigint
  account: string
}

/**
 * Counted, not derived from the reserve id: the id is an index within one
 * market, so building addresses out of it gave Core's first reserve and Prime's
 * the same aToken and each market read the other's balance.
 */
let minted = 0

const reserve = (over: Partial<Reserve> & { id: number; symbol: string }): Reserve => ({
  underlying: fake(`c${++minted}`),
  aToken: fake(`a${minted}`),
  debtToken: fake(`d${minted}`),
  stableDebtToken: fake(`5${minted}`),
  decimals: 18n,
  supplied: 0n,
  borrowed: 0n,
  ltv: 7500n,
  threshold: 7800n,
  ...over,
})

/** bit 2i borrows reserve i, bit 2i+1 has it enabled as collateral. */
const collateralBit = (id: number): bigint => 1n << BigInt(id * 2 + 1)
const borrowBit = (id: number): bigint => 1n << BigInt(id * 2)

const USDC = reserve({
  id: 0,
  symbol: 'USDC',
  decimals: 6n,
  supplied: 1000n * 10n ** 6n,
  borrowed: 500n * 10n ** 6n,
})

/**
 * Supplied for yield with the collateral switch off — the case that made a whole
 * market disappear, because it contributes nothing to `getUserAccountData`.
 */
const LINK = reserve({ id: 1, symbol: 'LINK', supplied: 40n * 10n ** 18n })

/** Listed with a zero threshold, so it cannot secure a borrow whatever the bit says. */
const FROZEN = reserve({ id: 2, symbol: 'FRZ', supplied: 5n * 10n ** 18n, ltv: 0n, threshold: 0n })

const WETH = reserve({ id: 0, symbol: 'WETH', supplied: 2n * 10n ** 18n })

const EMPTY_ACCOUNT = accountReturn(0n, 0n, MAX_UINT)

const MARKETS: Record<string, Market> = {
  [CORE.toLowerCase()]: {
    reserves: [USDC, LINK, FROZEN],
    config: collateralBit(0) | borrowBit(0) | collateralBit(2),
    account: accountReturn(1000n * 10n ** 8n, 500n * 10n ** 8n, 15n * 10n ** 17n),
  },
  [PRIME.toLowerCase()]: {
    reserves: [WETH],
    config: collateralBit(0),
    account: accountReturn(2n * 10n ** 8n, 0n, MAX_UINT),
  },
  // Supplied, but with nothing switched on as collateral, so every figure this
  // market reports about the account is zero.
  [ETHERFI.toLowerCase()]: {
    reserves: [reserve({ id: 0, symbol: 'weETH', supplied: 3n * 10n ** 18n })],
    config: 0n,
    account: EMPTY_ACCOUNT,
  },
  [HORIZON.toLowerCase()]: {
    reserves: [reserve({ id: 0, symbol: 'RWA' })],
    config: 0n,
    account: EMPTY_ACCOUNT,
  },
  // One market each, and the same USDC ticker as Ethereum Core: netting is by
  // asset, so a supply on Arbitrum has to meet a supply on Ethereum in one row.
  [ARBITRUM.toLowerCase()]: {
    reserves: [reserve({ id: 0, symbol: 'USDC', decimals: 6n, supplied: 250n * 10n ** 6n })],
    config: collateralBit(0),
    account: accountReturn(250n * 10n ** 8n, 0n, MAX_UINT),
  },
  [BASE.toLowerCase()]: {
    reserves: [reserve({ id: 0, symbol: 'USDC', decimals: 6n, supplied: 100n * 10n ** 6n })],
    config: collateralBit(0),
    account: accountReturn(100n * 10n ** 8n, 0n, MAX_UINT),
  },
}

const original = globalThis.fetch

/** Every environment name the read consults, restored after each test. */
const ENV = CHAINS.flatMap((c) => c.rpcEnv)
const savedEnv = new Map(ENV.map((name) => [name, process.env[name]] as const))

/** One node per chain, and a URL nothing has answered for yet each time. */
const NODE = new Map<ChainId, string>()
const chainOfNode = (url: string): ChainId =>
  [...NODE].find(([, at]) => at === url)![0]

/** Every contract the read actually reached, lower-cased. */
let touched: string[] = []

/** Every node URL it reached them through. */
let nodesUsed: string[] = []

/**
 * `dead` names a pool whose account read answers with an error, not a zero;
 * `short` names one that answers successfully but with too few words.
 */
/**
 * The eMode category the stubbed account is in, if any. `collateral` is the
 * bitmap of reserve ids inside it and `threshold` its own liquidation threshold
 * in basis points — the two figures that decide what Aave would liquidate this
 * account against, and neither is on the reserve.
 */
interface StubEMode {
  category: number
  threshold: number
  collateral: bigint
  /** The category view reverting, which must never read as a threshold of zero. */
  silent?: boolean
}

function stubNode(
  dead: string | null = null,
  short: string | null = null,
  downChain: ChainId | null = null,
  /** One chain's node answering this many ms behind the others. */
  slow: { chain: ChainId; ms: number } | null = null,
  eMode: StubEMode | null = null,
): void {
  touched = []
  nodesUsed = []
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    nodesUsed.push(url)
    const chain = chainOfNode(url)
    if (downChain && chain === downChain) return new Response('slow down', { status: 429 })
    // Every request to that node, so the chain's whole read lands late — which
    // is when its rows are stamped.
    if (slow?.chain === chain) await new Promise((done) => setTimeout(done, slow.ms))

    const body = JSON.parse(init?.body ?? '[]')
    // `eth_chainId` goes out on its own, not in the batch: a node answering for
    // another chain would report every market on it as empty rather than fail.
    if (!Array.isArray(body)) {
      const eip155 = CHAINS.find((c) => c.id === chain)!.eip155
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${eip155.toString(16)}` }),
        { status: 200 },
      )
    }
    const calls = body as Array<{
      id: number
      params: [{ to: string; data: string }, string]
    }>
    const out = calls.map(({ id, params }) => {
      const to = params[0].to.toLowerCase()
      const data = params[0].data
      const selector = data.slice(0, 10)
      const market = MARKETS[to]
      touched.push(to)

      if (selector === '0xbf92857c') {
        if (dead && to === dead.toLowerCase()) return { id, error: { message: 'execution reverted' } }
        if (short && to === short.toLowerCase()) return { id, result: '0x' }
        return { id, result: market ? market.account : EMPTY_ACCOUNT }
      }
      if (selector === '0x4417a583') return { id, result: '0x' + word(market?.config ?? 0n) }
      // eMode: which category the account is in, and that category's collateral
      // threshold and membership bitmap.
      if (selector === '0xeddf1b79') return { id, result: '0x' + word(BigInt(eMode?.category ?? 0)) }
      if (selector === '0xb286f467') {
        if (eMode?.silent) return { id, error: { message: 'execution reverted' } }
        return { id, result: '0x' + word(0n) + word(BigInt(eMode?.threshold ?? 0)) + word(0n) }
      }
      if (selector === '0xb0771dba') return { id, result: '0x' + word(eMode?.collateral ?? 0n) }
      if (selector === '0xd1946dbc' && market) {
        return {
          id,
          result:
            '0x' +
            word(32n) +
            word(BigInt(market.reserves.length)) +
            market.reserves.map((r) => addressWord(r.underlying)).join(''),
        }
      }
      if (selector === '0x35ea6a75' && market) {
        const asked = '0x' + data.slice(34)
        const r = market.reserves.find((one) => one.underlying === asked)
        if (r) return { id, result: reserveDataReturn(r) }
      }

      const all = Object.values(MARKETS).flatMap((m) => m.reserves)
      const owner = all.find(
        (r) => r.underlying === to || r.aToken === to || r.debtToken === to || r.stableDebtToken === to,
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

/**
 * A node URL per chain that nothing else has used, so the reserve cache is cold
 * and `assertChain` has not already identified the endpoint. It is also how the
 * cache key is exercised: one Pool address is deployed on four chains.
 */
let nodes = 0
beforeEach(() => {
  nodes += 1
  // Rotation is per process, and each test gets fresh URLs: a chain left on its
  // second node would start the next test one past the node it just pinned.
  resetRotation()
  for (const name of ENV) delete process.env[name]
  for (const chain of CHAINS) {
    const url = `https://node-${nodes}-${chain.id}.invalid/rpc`
    NODE.set(chain.id, url)
    process.env[chain.rpcEnv[0]!] = url
  }
})

afterEach(() => {
  globalThis.fetch = original
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('aave across every market on the chain', () => {
  test('collateral supplied to a second market is not missing because the first answered', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    const prime = positions.find((p) => p.venue === 'aave-prime' && p.kind === 'collateral')
    expect(prime?.quantity.toString()).toBe('2')
  })

  test('the market almost every account is in keeps the bare venue id', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    const core = positions.find((p) => p.id === 'aave:collateral:USDC')
    expect(core?.venue).toBe('aave')
    expect(core?.quantity.toString()).toBe('1000')
  })

  test('every market on the chain is asked, not only the first', async () => {
    stubNode()
    await aaveConnector.fetchPositions(CREDS)
    for (const pool of [CORE, PRIME, ETHERFI, HORIZON]) {
      expect(touched).toContain(pool.toLowerCase())
    }
  })

  test('WETH nets as ETH wherever the market reports it', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    expect(positions.find((p) => p.venue === 'aave-prime')?.asset).toBe('ETH')
  })

  test('a market holding nothing at all contributes no rows', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    expect(positions.some((p) => p.venue.includes('horizon'))).toBe(false)
  })
})

describe('a supply is not collateral until the account says it is', () => {
  test('a market reporting zero collateral still reports what it holds', async () => {
    // `getUserAccountData` counts a reserve only when the collateral bit is set,
    // so a market supplied to for yield answers entirely in zeros. Skipping on
    // that answer dropped the whole market — an empty book, with no INCOMPLETE.
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    const held = positions.find((p) => p.venue === 'aave-etherfi')
    expect(held?.asset).toBe('WEETH')
    expect(held?.quantity.toString()).toBe('3')
  })

  test('a reserve the user has not enabled is not labelled collateral', async () => {
    stubNode()
    const link = (await aaveConnector.fetchPositions(CREDS)).find((p) => p.asset === 'LINK')
    expect(link?.kind).toBe('spot')
    expect(link?.quantity.toString()).toBe('40')
  })

  test('a supply that secures nothing is not handed the market’s health factor', async () => {
    // Rendered with one, it reads as a balance that can be seized, and it lands
    // in "what breaks first" beside collateral that genuinely can be.
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    expect(positions.find((p) => p.asset === 'LINK')?.liquidation).toBeUndefined()
    expect(positions.find((p) => p.id === 'aave:collateral:USDC')?.liquidation?.healthFactor?.toString()).toBe('1.5')
  })

  test('a debt is not covered by a balance the protocol cannot seize', async () => {
    stubNode()
    const debt = (await aaveConnector.fetchPositions(CREDS)).find((p) => p.kind === 'debt')
    expect(debt?.encumbers).toEqual(['aave:collateral:USDC'])
  })

  test('a reserve with no liquidation threshold is not collateral even with the bit set', async () => {
    // Aave's own account maths skips a zero-threshold reserve, so counting it
    // here would put collateral behind a debt that it does not stand behind.
    stubNode()
    const frozen = (await aaveConnector.fetchPositions(CREDS)).find((p) => p.asset === 'FRZ')
    expect(frozen?.kind).toBe('spot')
  })

  test('the debt token is asked for only where the account says it borrows', async () => {
    // Aave sets the borrow bit on the borrow and clears it on the last
    // repayment, so — unlike the collateral bit — it cannot be off while a
    // balance is on. That is what makes skipping the rest of the debt calls a
    // fact about the account rather than a guess about it.
    stubNode()
    await aaveConnector.fetchPositions(CREDS)
    expect(touched).toContain(USDC.debtToken.toLowerCase())
    expect(touched).not.toContain(LINK.debtToken.toLowerCase())
  })

  test('each market carries its own health factor, not the first one found', async () => {
    stubNode()
    const positions = await aaveConnector.fetchPositions(CREDS)
    // No debt in Prime, so max-uint, which is not a health factor.
    expect(positions.find((p) => p.venue === 'aave-prime')?.liquidation).toBeUndefined()
  })
})

describe('reserve configuration', () => {
  test('the threshold travels on the leg, so a shock weights each asset by its own', async () => {
    // Weighted by value alone, a shock treats one collateral asset falling as
    // though the whole market had fallen with it.
    stubNode()
    const core = (await aaveConnector.fetchPositions(CREDS)).find(
      (p) => p.id === 'aave:collateral:USDC',
    )
    expect(core?.liquidation?.liquidationThreshold?.toString()).toBe('0.78')
  })

  test('a supply that secures nothing carries no threshold either', async () => {
    stubNode()
    const link = (await aaveConnector.fetchPositions(CREDS)).find((p) => p.asset === 'LINK')
    expect(link?.liquidation).toBeUndefined()
  })

  test('the per-asset threshold is read, not the account-wide average', () => {
    // Ethereum Core USDC, checked on-chain: 75% LTV, 78% liquidation threshold.
    const { ltv, liquidationThreshold } = reserveConfig(word(configWord(7500n, 7800n)))
    expect(ltv.toString()).toBe('0.75')
    expect(liquidationThreshold.toString()).toBe('0.78')
  })

  test('the collateral bit is read at the reserve’s own index, not its list position', () => {
    // USDC is reserve 3 on Ethereum Core, so its collateral bit is bit 7.
    expect(usedAsCollateral(0b10000000n, 3)).toBe(true)
    expect(usedAsCollateral(0b10000000n, 2)).toBe(false)
    // The low bit of a pair means borrowing, and never that it is collateral.
    expect(usedAsCollateral(0b01000000n, 3)).toBe(false)
  })
})

describe('the reserve cache cannot answer for the wrong chain', () => {
  test('the same pool address on a second node is read again, not served from the first', async () => {
    stubNode()
    await aaveConnector.fetchPositions(CREDS)
    // Aave v3's Pool is the same address on Polygon, Arbitrum, Avalanche and
    // Optimism. Keyed by pool alone, the second read here would take the first
    // chain's reserve list and then ask a different chain's token addresses.
    process.env['TULA_ETHEREUM_RPC'] = NODE.get('ethereum')!.replace('.invalid', '-b.invalid')
    NODE.set('ethereum', process.env['TULA_ETHEREUM_RPC'])
    stubNode()
    await aaveConnector.fetchPositions(CREDS)
    expect(touched.filter((t) => t === CORE.toLowerCase()).length).toBeGreaterThan(1)
  })

  test('two chains pointed at one endpoint is refused, not quietly crossed', async () => {
    // What makes a node URL usable as part of the cache key at all: without
    // this, one endpoint configured for two chains would serve Base whatever
    // reserve list Arbitrum had cached — the pool-alone defect one level along.
    process.env['TULA_BASE_RPC'] = NODE.get('arbitrum')!
    stubNode()
    const err = (await aaveConnector.fetchPositions(CREDS).catch((e: unknown) => e)) as PartialRead
    expect(err.failures[0]).toMatch(/answers for chain 42161, not 8453/)
    expect(err.positions.some((p) => p.venue === 'aave-arbitrum')).toBe(true)
  })
})

describe('aave on every chain it is deployed to, under one address', () => {
  test('a market on a second chain is read without the address being entered again', async () => {
    stubNode()
    const rows = await aaveConnector.fetchPositions(CREDS)
    expect(rows.find((p) => p.venue === 'aave-arbitrum')?.quantity.toString()).toBe('250')
    expect(rows.find((p) => p.venue === 'aave-base')?.quantity.toString()).toBe('100')
  })

  test('one asset nets across chains while each row keeps the chain it sits on', async () => {
    stubNode()
    const usdc = (await aaveConnector.fetchPositions(CREDS)).filter((p) => p.asset === 'USDC')
    // One asset id, so the book states one USDC figure — and three venues, so
    // `breaks` can still say which chain the collateral to act on is on.
    expect(new Set(usdc.map((p) => p.asset)).size).toBe(1)
    expect(new Set(usdc.map((p) => p.venue))).toEqual(
      new Set(['aave', 'aave-arbitrum', 'aave-base']),
    )
    expect(new Set(usdc.map((p) => p.id)).size).toBe(usdc.length)
  })

  test('a chain that answered late does not date the chains that answered first', async () => {
    // Base held back, so the stamps are separable at all: at full speed the
    // three chains land inside one millisecond and a single `new Date()` for
    // the whole venue satisfies everything below.
    stubNode(null, null, null, { chain: 'base', ms: 25 })
    const rows = await aaveConnector.fetchPositions(CREDS)

    const stamps = (of: (venue: string) => boolean): number[] => [
      ...new Set(rows.filter((p) => of(p.venue)).map((p) => p.asOf.getTime())),
    ]
    const behind = stamps((v) => v === 'aave-base')
    const first = stamps((v) => v !== 'aave-base')
    expect(behind).toHaveLength(1)
    expect(first.length).toBeGreaterThan(0)
    // Stamp the whole venue once and these go equal, so a lagging chain is
    // published under the freshest one's time — and every aggregate inherits
    // the oldest of its contributors, which would then be the wrong number.
    for (const stamp of first) expect(stamp).toBeLessThan(behind[0]!)
  })
})

describe('a chain that fails takes only itself off the book', () => {
  test('one chain down leaves the markets on the others readable', async () => {
    stubNode(null, null, 'arbitrum')
    const err = (await aaveConnector.fetchPositions(CREDS).catch((e: unknown) => e)) as PartialRead
    expect(err).toBeInstanceOf(PartialRead)
    expect(err.positions.some((p) => p.venue === 'aave')).toBe(true)
    expect(err.positions.some((p) => p.venue === 'aave-base')).toBe(true)
    expect(err.positions.some((p) => p.venue === 'aave-arbitrum')).toBe(false)
  })

  test('the failure names the chain that went, not the one that answered', async () => {
    stubNode(null, null, 'base')
    const err = (await aaveConnector.fetchPositions(CREDS).catch((e: unknown) => e)) as PartialRead
    expect(err.failures).toHaveLength(1)
    expect(err.failures[0]).toContain('Base')
    expect(err.failures[0]).toContain('TULA_BASE_RPC')
    expect(err.failures[0]).not.toContain('Ethereum')
  })

  test('a chain whose first node is rate-limited is retried, not lost', async () => {
    // The whole read of a chain runs at once — the identity call beside the
    // account batch — so a 429 on the first call used to take the chain down
    // before anything could move it, and Aave came back INCOMPLETE.
    const busy = `https://node-${nodes}-base-busy.invalid/rpc`
    process.env['TULA_BASE_RPC'] = `${busy},${NODE.get('base')!}`
    stubNode()
    const answering = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: { body?: string }) =>
      url === busy
        ? new Response('slow down', { status: 429 })
        : answering(url as never, init as never)) as unknown as typeof fetch

    const rows = await aaveConnector.fetchPositions(CREDS)
    expect(rows.some((p) => p.venue === 'aave-base')).toBe(true)
  })

  test('a market that does not answer fails only its own chain, not the venue', async () => {
    // Ethereum's four markets share a node, so they still fail together — but
    // Arbitrum and Base are read through nodes of their own and stay on the book.
    stubNode(PRIME)
    const err = (await aaveConnector.fetchPositions(CREDS).catch((e: unknown) => e)) as PartialRead
    expect(err.failures[0]).toContain('Prime')
    expect(err.positions.every((p) => p.venue !== 'aave')).toBe(true)
    expect(err.positions.some((p) => p.venue === 'aave-arbitrum')).toBe(true)
  })
})

describe('a node that will not answer is never read as an empty book', () => {
  test('a market that answers short fails rather than reading as holding nothing', async () => {
    stubNode(null, PRIME)
    await expect(aaveConnector.fetchPositions(CREDS)).rejects.toThrow(/unreadable/)
  })

  test('a truncated answer never renders as a health factor of zero', async () => {
    stubNode(null, CORE)
    await expect(aaveConnector.fetchPositions(CREDS)).rejects.toThrow(/Core/)
  })

  test('a market that does not answer fails the venue rather than reading as empty', async () => {
    stubNode(PRIME)
    await expect(aaveConnector.fetchPositions(CREDS)).rejects.toThrow(/Prime/)
  })
})

// Written to be broken by progress: closing one of these gaps fails its test,
// which forces the matching line out of `coverage.doesNotRead` in the same
// change. Without that, the connector goes on telling the reader it cannot see
// something it now sees.
describe('the gaps this connector declares are still gaps', () => {
  const gap = (fragment: string): void => {
    expect((aaveConnector.coverage?.doesNotRead ?? []).some((g) => g.what.includes(fragment))).toBe(
      true,
    )
  }

  test('Aave V4 is declared unread, and no Hub is called', async () => {
    gap('Aave V4')
    stubNode()
    await aaveConnector.fetchPositions(CREDS)
    for (const hub of V4_HUBS) expect(touched).not.toContain(hub.toLowerCase())
  })

  test('stable-rate debt is declared unread, and its token is never asked for a balance', async () => {
    gap('stable-rate debt')
    stubNode()
    await aaveConnector.fetchPositions(CREDS)
    expect(touched).not.toContain(USDC.stableDebtToken.toLowerCase())
  })

  test('the Safety Module is declared unread, and its stake contract is never called', async () => {
    gap('Safety Module')
    stubNode()
    await aaveConnector.fetchPositions(CREDS)
    expect(touched).not.toContain(STK_AAVE.toLowerCase())
  })

  test('the chains with no Pool in the build are declared unread, and no fourth node is reached', async () => {
    gap('every chain but')
    gap('HyperEVM')
    stubNode()
    await aaveConnector.fetchPositions(CREDS)
    // Six markets over three chains: a fourth chain would be a fourth node, and
    // there are exactly three because those are the only Pools in the build.
    expect(new Set(nodesUsed).size).toBe(CHAINS.length)
  })

  test('a leg inside the account’s eMode category carries the category’s threshold', async () => {
    // Aave liquidates an eMode account on the category's numbers, not the
    // reserve's. Weighted by the reserve's, every shock is measured against a
    // bar the lender would not use — under a health factor Aave did state,
    // which is why nothing about the row looks wrong.
    stubNode(null, null, null, null, { category: 1, threshold: 9500, collateral: 1n << 0n })
    const usdc = (await aaveConnector.fetchPositions(CREDS)).find(
      (p) => p.venue === 'aave' && p.asset === 'USDC' && p.kind === 'collateral',
    )
    expect(usdc?.liquidation?.liquidationThreshold?.toString()).toBe('0.95')
  })

  test('a reserve the category does not hold keeps its own threshold', async () => {
    // Liquid eMode still counts out-of-category collateral, at its own rate —
    // it does not exclude it the way the older eMode did.
    stubNode(null, null, null, null, { category: 1, threshold: 9500, collateral: 1n << 0n })
    const rows = await aaveConnector.fetchPositions(CREDS)
    const frozen = rows.find((p) => p.asset === 'FRZ')
    expect(frozen?.liquidation?.liquidationThreshold?.toString()).not.toBe('0.95')
  })

  test('a reserve at threshold zero inside a category is collateral, not a plain supply', async () => {
    // The severe half. Gated on the reserve's own threshold, a leg Aave holds
    // as collateral at 95% is not weighted wrongly — it stops being a
    // collateral leg at all: no liquidation block, and out of the list the debt
    // beside it says it is covered by. Aave has live reserves in exactly this
    // shape, at a reserve threshold of 0 inside a category at 92-95%.
    stubNode(null, null, null, null, { category: 1, threshold: 9500, collateral: 1n << 2n })
    const frozen = (await aaveConnector.fetchPositions(CREDS)).find((p) => p.asset === 'FRZ')
    expect(frozen?.kind).toBe('collateral')
    expect(frozen?.liquidation?.liquidationThreshold?.toString()).toBe('0.95')
  })

  test('an account in no category reads exactly as it did before', async () => {
    stubNode(null, null, null, null, null)
    const usdc = (await aaveConnector.fetchPositions(CREDS)).find(
      (p) => p.venue === 'aave' && p.asset === 'USDC' && p.kind === 'collateral',
    )
    expect(usdc?.liquidation?.liquidationThreshold?.toString()).toBe('0.78')
  })

  test('a category that will not answer fails, rather than reading as a threshold of zero', async () => {
    // Defaulted to zero it would take every collateral leg in the category off
    // the book — the account reads as unsecured debt, which is the reassuring
    // shape of a wrong number.
    stubNode(null, null, null, null, { category: 1, threshold: 9500, collateral: 1n, silent: true })
    await expect(aaveConnector.fetchPositions(CREDS)).rejects.toThrow(/eMode category/)
  })

  test('isolation mode is declared unread, and the debt ceiling stays undecoded', () => {
    gap('isolation mode')
    // The ceiling sits in the same configuration word as the two fields below,
    // so reading it is a line here — and the day it is, this fails.
    expect(Object.keys(reserveConfig(word(configWord(7500n, 7800n))))).toEqual([
      'ltv',
      'liquidationThreshold',
    ])
  })

})

/**
 * Captured from the chains themselves by `scripts/capture-onchain.ts`. A Pool
 * address that is not deployed where it was configured answers `0x`, which
 * reads as a market with no reserves rather than as an error — so the only
 * thing that can contradict a wrong address is the chain's own answer.
 */
describe('every Pool in the build answers on the chain it was put on', () => {
  const captured = (id: ChainId) =>
    JSON.parse(
      readFileSync(new URL(`../../fixtures/chains/${id}.json`, import.meta.url), 'utf8'),
    ) as { aave: { market: string; reserves: string[] }[] }

  for (const deployment of DEPLOYMENTS) {
    test(`Aave ${deployment.market} on ${deployment.chain} listed reserves`, () => {
      const market = captured(deployment.chain).aave.find((m) => m.market === deployment.market)
      expect(market?.reserves.length).toBeGreaterThan(0)
    })
  }

  test('every chain in the build has a Pool, so none of them is silently unread', () => {
    for (const chain of CHAINS) {
      expect(DEPLOYMENTS.some((d) => d.chain === chain.id)).toBe(true)
    }
  })
})
