import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import Decimal from 'decimal.js'
import { CHAINS, chainById, ETHEREUM, type ChainId } from './chains.js'
import { SELECTOR } from './evm.js'
import { PartialRead } from './types.js'
import {
  assetName,
  chainTokens,
  contested,
  LEDGER_FRONTENDS,
  toPositions,
  walletConnector,
  type TokenEntry,
} from './wallet.js'

const token = (over: Partial<TokenEntry>): TokenEntry => ({
  chainId: 1,
  address: '0x6b175474e89094c44da98b954eedeac495271d0f',
  symbol: 'DAI',
  decimals: 18,
  ...over,
})

/** Both are real, both are on the live Uniswap list, and both are called LIT. */
const LITENTRY = '0xb59490ab09a0f526cc7305822ac65f2ab12f9723'
const LIGHTER = '0x232ce3bd40fcd6f80f3d55a522d03f25df784ee2'

describe('token list filtering', () => {
  test('a chain is asked only about the tokens the list names for it', () => {
    // One multichain feed answers for every chain, so the chain id is the
    // filter. Filtered wrong, a chain is read against another chain's contract
    // addresses — which hold no code, answer `0x`, and report as zero.
    const list = [token({}), token({ chainId: 42161, symbol: 'ARB' })]
    expect(chainTokens(list, ETHEREUM).map((t) => t.symbol)).toEqual(['DAI'])
    expect(chainTokens(list, chainById('arbitrum')).map((t) => t.symbol)).toEqual(['ARB'])
  })

  test('drops Aave receipt tokens so a wallet never double-counts collateral', () => {
    const kept = chainTokens(
      [token({}), token({ symbol: 'aEthUSDC' }), token({ symbol: 'variableDebtEthWETH' })],
      ETHEREUM,
    )
    expect(kept.map((t) => t.symbol)).toEqual(['DAI'])
  })

  test('a token whose address is malformed is not asked about', () => {
    expect(chainTokens([token({ address: 'not-an-address' })], ETHEREUM)).toHaveLength(0)
  })

  test('receipt tokens are dropped under every chain tag Aave spells them with', () => {
    // The SmolDapp lists Gnosis and Linea default to carry these by name, in the
    // case Aave writes them — which is the whole of what `RECEIPT` matches on.
    const gnosis = chainById('gnosis')
    const linea = chainById('linea')
    const polygon = chainById('polygon')
    const list = [
      token({ chainId: gnosis.eip155, symbol: 'aGnoWXDAI' }),
      token({ chainId: linea.eip155, symbol: 'aLinUSDC' }),
      token({ chainId: polygon.eip155, symbol: 'variableDebtPolWETH' }),
    ]
    for (const chain of [gnosis, linea, polygon]) expect(chainTokens(list, chain)).toHaveLength(0)
  })

  test('an entry whose decimals would inflate or zero a balance is dropped, and the rest are kept', () => {
    const bad = [-1, 78, 1.5, Number.NaN, '18'].map((decimals) =>
      token({ symbol: `BAD${String(decimals)}`, decimals: decimals as number }),
    )
    const kept = chainTokens([...bad, token({}), token({ symbol: 'ZERO', decimals: 0 })], ETHEREUM)
    expect(kept.map((t) => t.symbol)).toEqual(['DAI', 'ZERO'])
  })

  test('an entry that is not the Token Lists shape is dropped rather than failing the chain', () => {
    const malformed: unknown[] = [
      null,
      'DAI',
      { ...token({}), symbol: 42 },
      { ...token({}), symbol: '  ' },
      { ...token({}), address: 0x6b175474 },
      { ...token({}), address: `${token({}).address}00` },
      { ...token({}), chainId: '1' },
    ]
    expect(chainTokens([...malformed, token({})], ETHEREUM).map((t) => t.symbol)).toEqual(['DAI'])
  })

  test('a legacy frontend is not read beside the contract whose ledger it shows, so one balance is not two', () => {
    const gnosis = chainById('gnosis')
    const list = [
      token({ chainId: gnosis.eip155, symbol: 'EURe', address: '0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430' }),
      token({ chainId: gnosis.eip155, symbol: 'EURe', address: '0xcB444e90D8198415266c6a2724b7900fb12FC56E' }),
    ]
    expect(chainTokens(list, gnosis).map((t) => t.address.toLowerCase())).toEqual([
      '0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430',
    ])
  })

  test('the address a list gives the gas token is not asked for a balance', () => {
    // Read by eth_getBalance already; asked balanceOf, it holds no contract.
    const sentinel = `0x${'Ee'.repeat(20)}`
    const scroll = chainById('scroll')
    expect(
      chainTokens([token({ chainId: scroll.eip155, symbol: 'ETH', address: sentinel })], scroll),
    ).toHaveLength(0)
  })
})

describe('two tokens with one name are two holdings', () => {
  const both = [
    token({ symbol: 'LIT', address: LITENTRY }),
    token({ symbol: 'LIT', address: LIGHTER }),
  ]

  test('a symbol claimed twice is spotted before either balance is read', () => {
    expect(contested(both)).toEqual(new Set(['LIT']))
    expect(contested([token({})])).toEqual(new Set())
  })

  test('they do not collapse into one id, summed and priced once', () => {
    const rows = toPositions(
      both.map((t, i) => ({
        symbol: t.symbol,
        amount: new Decimal(i + 1),
        address: t.address,
        contested: true,
      })),
      new Date(),
    )
    expect(new Set(rows.map((p) => p.id)).size).toBe(2)
    expect(new Set(rows.map((p) => p.asset)).size).toBe(2)
  })

  test('a symbol only one token answers to is left alone', () => {
    expect(assetName({ symbol: 'DAI', amount: new Decimal(1), address: token({}).address })).toBe(
      'DAI',
    )
  })

  test('the contract the row means is named, since the symbol no longer says', () => {
    const name = assetName({
      symbol: 'LIT',
      amount: new Decimal(1),
      address: LITENTRY,
      contested: true,
    })
    expect(name).toContain('LIT')
    expect(name).toContain(LITENTRY.slice(0, 10))
  })
})

describe('positions', () => {
  const asOf = new Date('2026-08-31T00:00:00Z')

  test('zero balances are dropped rather than rendered', () => {
    const out = toPositions(
      [
        { symbol: 'ETH', amount: new Decimal(2) },
        { symbol: 'DAI', amount: new Decimal(0) },
      ],
      asOf,
    )
    expect(out.map((p) => p.asset)).toEqual(['ETH'])
  })

  test('spot holdings are positive and carry their own delta and asOf', () => {
    const [position] = toPositions(
      [{ symbol: 'dai', amount: new Decimal('1.5'), address: token({}).address }],
      asOf,
    )
    expect(position?.kind).toBe('spot')
    expect(position?.asset).toBe('DAI')
    expect(position?.quantity.toString()).toBe('1.5')
    expect(position?.delta.toString()).toBe('1.5')
    expect(position?.asOf).toEqual(asOf)
  })

  test('WETH nets as ETH here too, or one holding reads as two', () => {
    // Aave canonicalised it and the wallet did not, so a WETH balance supplied
    // to Aave and a WETH balance held in the wallet never met.
    const [position] = toPositions(
      [{ symbol: 'WETH', amount: new Decimal(1), address: token({}).address }],
      asOf,
    )
    expect(position?.asset).toBe('ETH')
  })

  test('each wrapped gas token nets with the native balance it wraps, on its own chain', () => {
    const on = (id: ChainId, symbol: string) =>
      toPositions([{ symbol, amount: new Decimal(1), address: token({}).address }], asOf, chainById(id))[0]?.asset
    expect([on('polygon', 'WPOL'), on('polygon', 'WMATIC'), on('avalanche', 'WAVAX'), on('gnosis', 'WXDAI')]).toEqual(
      ['POL', 'POL', 'AVAX', 'XDAI'],
    )
  })

  test('a wrap on a chain where its token is not gas is a bridge’s, not the wrap', () => {
    // WETH on Polygon is the PoS bridge's claim on ether, not ether wrapped.
    const polygon = chainById('polygon')
    const [row] = toPositions([{ symbol: 'WETH', amount: new Decimal(1), address: token({}).address }], asOf, polygon)
    expect(row?.asset).toBe('polygon:WETH')
  })
})


const original = globalThis.fetch

/** Every environment name the read consults, restored after each test. */
const ENV = [...CHAINS.flatMap((c) => c.rpcEnv), ...CHAINS.flatMap((c) => c.tokenListEnv)]
const saved = new Map(ENV.map((name) => [name, process.env[name]] as const))

/**
 * Fresh URLs per stub. `assertChain` remembers what a URL said it was, so a
 * second test reusing one would skip the check it exists to make.
 */
let run = 0
let listUrl = ''
const nodeOf = new Map<ChainId, string>()

/** Every contract the read reached, and the node it reached it through. */
let asked: Array<{ node: string; to: string; selector: string }> = []

interface Stub {
  /** The whole feed, every chain in one array, as a real Token Lists URL serves. */
  tokens: TokenEntry[]
  /** Chains whose node answers HTTP 500 — one public node rate-limiting. */
  down?: ChainId[]
  /** The list URL itself is unreachable. */
  listDown?: boolean
  /** The list URL answers 200 with this body instead of the tokens. */
  listBody?: string
  /** Balances, keyed by lower-cased contract. Anything unnamed answers 1e18. */
  balances?: Record<string, bigint>
  /** What `decimals()` answers, keyed by lower-cased contract; null reverts. Unnamed, it answers like `balanceOf`. */
  decimals?: Record<string, number | null>
  /** One chain's node answers this many ms behind the others. */
  slow?: { chain: ChainId; ms: number }
}

function stubChains(stub: Stub): void {
  run += 1
  asked = []
  listUrl = `https://tokens-${run}.invalid/list.json`
  for (const name of ENV) delete process.env[name]
  process.env['TULA_TOKEN_LIST'] = listUrl
  for (const chain of CHAINS) {
    const url = `https://node-${run}-${chain.id}.invalid/rpc`
    nodeOf.set(chain.id, url)
    process.env[chain.rpcEnv[0]!] = url
  }

  const down = new Set((stub.down ?? []).map((id) => nodeOf.get(id)))

  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (url === listUrl) {
      if (stub.listDown) return new Response('nope', { status: 503 })
      if (stub.listBody !== undefined) return new Response(stub.listBody, { status: 200 })
      return new Response(JSON.stringify({ tokens: stub.tokens }), { status: 200 })
    }
    if (down.has(url)) return new Response('slow down', { status: 429 })

    const chain = CHAINS.find((c) => nodeOf.get(c.id) === url)!
    // Every request to that node, so the chain's whole read lands late — which
    // is when its rows are stamped.
    if (stub.slow?.chain === chain.id) await new Promise((done) => setTimeout(done, stub.slow!.ms))
    const body = JSON.parse(init?.body ?? '{}')
    if (!Array.isArray(body)) {
      if (body.method === 'eth_chainId') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${chain.eip155.toString(16)}` }),
          { status: 200 },
        )
      }
      // eth_getBalance: one ETH on every chain, so netting has something to net.
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${(10n ** 18n).toString(16)}` }),
        { status: 200 },
      )
    }
    const out = body.map((call: { id: number; params: [{ to: string; data: string }] }) => {
      const to = call.params[0].to.toLowerCase()
      const selector = call.params[0].data.slice(0, 10)
      asked.push({ node: url, to, selector })
      if (selector === SELECTOR.decimals && stub.decimals && to in stub.decimals) {
        const stated = stub.decimals[to]
        return stated === null || stated === undefined
          ? { id: call.id, error: { message: 'execution reverted' } }
          : { id: call.id, result: `0x${stated.toString(16).padStart(64, '0')}` }
      }
      const balance = stub.balances?.[to]
      if (balance === undefined && stub.balances && to in stub.balances) {
        return { id: call.id, error: { message: 'execution reverted' } }
      }
      return {
        id: call.id,
        result: `0x${(balance ?? 10n ** 18n).toString(16).padStart(64, '0')}`,
      }
    })
    return new Response(JSON.stringify(out), { status: 200 })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = original
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

const ADDRESS = '0x0000000000000000000000000000000000000abc'

/** Circle's own USDC, from its contract-address page; it issues none on Gnosis or Scroll. */
const CIRCLE: Record<number, string> = {
  1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  42161: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  137: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  10: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
  43114: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
  59144: '0x176211869ca2b568f2a7d4ee941e073a821ee1ff',
}

const ARBITRUM_BRIDGED_USDC = '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'

/** The same contract on three chains is three contracts; built, never written out. */
const at = (chainId: number, n: number): string =>
  `0x${chainId.toString(16).padStart(8, '0')}${n.toString(16).padStart(32, '0')}`

/** One holding of a symbol per chain — the case that has to net into one row. */
const everywhere = (symbol: string, decimals = 6): TokenEntry[] =>
  CHAINS.map((c, i) => ({ chainId: c.eip155, address: at(c.eip155, i + 1), symbol, decimals }))

const read = (): Promise<import('../core/position.js').Position[]> =>
  walletConnector.fetchPositions({ address: ADDRESS })

describe('one address, every chain', () => {
  test('a second chain is read without the address being entered again', async () => {
    // The credential is the address and there is one of it. A chain that
    // needed its own would be a second venue to connect, which is the thing
    // this closes.
    stubChains({ tokens: everywhere('USDC') })
    const rows = await read()
    expect(new Set(rows.map((p) => p.venue))).toEqual(
      new Set(['wallet', ...CHAINS.slice(1).map((c) => `wallet-${c.id}`)]),
    )
  })

  test('a chain is read against its own node, never another chain’s', async () => {
    stubChains({ tokens: everywhere('USDC') })
    await read()
    for (const chain of CHAINS) {
      const theirs = chainTokens(everywhere('USDC'), chain).map((t) => t.address.toLowerCase())
      const reached = asked
        .filter((a) => a.node === nodeOf.get(chain.id) && a.selector === SELECTOR.balanceOf)
        .map((a) => a.to)
      expect(reached).toEqual(theirs)
    }
  })

  test('a token the list names for one chain is not asked about on another', async () => {
    // Both the filter and the default had to generalize together: filtered to
    // chain 1 against three nodes, every chain reads Ethereum's tokens.
    const base = chainById('base')
    stubChains({
      tokens: [{ chainId: base.eip155, address: at(base.eip155, 9), symbol: 'CBETH', decimals: 18 }],
    })
    await read()
    const onBase = asked.filter((a) => a.node === nodeOf.get('base') && a.selector === SELECTOR.balanceOf)
    expect(onBase).toHaveLength(1)
    for (const other of ['ethereum', 'arbitrum'] as const) {
      expect(asked.filter((a) => a.node === nodeOf.get(other))).toHaveLength(0)
    }
  })
})

describe('one asset nets across chains; one position keeps its chain', () => {
  test('the issuer’s own stablecoin on every chain it issues on is one asset, not rows that never cancel', async () => {
    stubChains({
      tokens: Object.entries(CIRCLE).map(([chainId, address]) => ({
        chainId: Number(chainId),
        address,
        symbol: 'USDC',
        decimals: 6,
      })),
    })
    const rows = (await read()).filter((p) => p.asset === 'USDC')
    // One asset id, so `netExposure` buckets them together and the book states
    // one USDC figure rather than one per chain that each read as a holding.
    expect(rows).toHaveLength(Object.keys(CIRCLE).length)
  })

  test('a symbol on one chain per chain is not treated as contested', async () => {
    // Counted across chains instead of within one, every stablecoin on the book
    // would be claimed twice over, qualified by its contract address, and left
    // without a price — the whole book unpriced by a fix for two tokens.
    stubChains({ tokens: everywhere('USDC') })
    const rows = await read()
    expect(rows.some((p) => p.asset.includes('('))).toBe(false)
  })

  test('each row still says which chain it came from, or breaks cannot say what to act on', async () => {
    stubChains({ tokens: everywhere('UNI') })
    const rows = (await read()).filter((p) => p.asset === 'UNI')
    expect(new Set(rows.map((p) => p.venue)).size).toBe(CHAINS.length)
    // And the ids stay distinct, or one chain's row overwrites another's.
    expect(new Set(rows.map((p) => p.id)).size).toBe(CHAINS.length)
  })

  test('a native balance is that chain’s gas token, not ETH wherever it is read', async () => {
    // Filed under ETH, a Polygon balance of POL is priced as ether — a figure
    // thousands of times too large with nothing about the row to say so.
    stubChains({ tokens: [] })
    const rows = await read()
    expect(Object.fromEntries(rows.map((p) => [p.venue, p.asset]))).toEqual({
      wallet: 'ETH',
      'wallet-arbitrum': 'ETH',
      'wallet-base': 'ETH',
      'wallet-polygon': 'POL',
      'wallet-optimism': 'ETH',
      'wallet-avalanche': 'AVAX',
      'wallet-gnosis': 'XDAI',
      'wallet-scroll': 'ETH',
      'wallet-linea': 'ETH',
    })
  })
})

describe('a bridged token is not the token it is named after', () => {
  test('USDC.e does not net into USDC, so a broken bridge cannot hide inside it', async () => {
    // The bridged issue is not Circle's and is not redeemable at Circle. Netted
    // together, a depeg on one would be averaged away by the other, and the row
    // that is actually at risk would never appear.
    const arb = chainById('arbitrum')
    stubChains({
      tokens: [
        { chainId: arb.eip155, address: CIRCLE[arb.eip155]!, symbol: 'USDC', decimals: 6 },
        { chainId: arb.eip155, address: ARBITRUM_BRIDGED_USDC, symbol: 'USDC.e', decimals: 6 },
      ],
    })
    const assets = (await read()).map((p) => p.asset)
    expect(assets).toContain('USDC')
    expect(assets).toContain('arbitrum:USDC.E')
  })

  test('two bridges’ USDC.e are two assets, so one bridge failing is not averaged into the other', async () => {
    const arb = chainById('arbitrum')
    const polygon = chainById('polygon')
    stubChains({
      tokens: [
        { chainId: arb.eip155, address: ARBITRUM_BRIDGED_USDC, symbol: 'USDC.e', decimals: 6 },
        { chainId: polygon.eip155, address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', symbol: 'USDC.e', decimals: 6 },
      ],
    })
    const assets = (await read()).map((p) => p.asset)
    expect(assets).toContain('arbitrum:USDC.E')
    expect(assets).toContain('polygon:USDC.E')
  })

  test('two spellings of one bridge are two assets, not one contested symbol', () => {
    // They are distinct on the list, so neither is qualified by its contract
    // address: being told two tokens share a name is a different admission from
    // being told one of them is not what it says, and only the second is true.
    const arb = chainById('arbitrum')
    const list = [
      { chainId: arb.eip155, address: at(arb.eip155, 1), symbol: 'USDC', decimals: 6 },
      { chainId: arb.eip155, address: at(arb.eip155, 2), symbol: 'USDC.e', decimals: 6 },
    ]
    expect(contested(chainTokens(list, arb))).toEqual(new Set())
  })
})

describe('a chain that fails takes only itself off the book', () => {
  test('one node down leaves the other chains readable', async () => {
    stubChains({ tokens: everywhere('USDC'), down: ['arbitrum'] })
    const err = (await read().catch((e: unknown) => e)) as PartialRead
    expect(err).toBeInstanceOf(PartialRead)
    expect([...new Set(err.positions.map((p) => p.venue))].sort()).toEqual(
      CHAINS.filter((c) => c.id !== 'arbitrum')
        .map((c) => (c.id === ETHEREUM.id ? 'wallet' : `wallet-${c.id}`))
        .sort(),
    )
  })

  test('the failure names the chain that went, not the one that answered', async () => {
    // Every RPC failure used to open "The Ethereum node". On a three-chain book
    // that sends the reader to replace an endpoint that is working.
    stubChains({ tokens: everywhere('USDC'), down: ['base'] })
    const err = (await read().catch((e: unknown) => e)) as PartialRead
    expect(err.failures).toHaveLength(1)
    expect(err.failures[0]).toContain('Base')
    expect(err.failures[0]).toContain('TULA_BASE_RPC')
    expect(err.failures[0]).not.toContain('Ethereum')
  })

  test('every chain failing is a failure, not a book that reads as empty', async () => {
    // Answered as an empty wallet it is `$0.00` about an account nobody read,
    // which is the failure the whole tool exists to close.
    stubChains({ tokens: everywhere('USDC'), down: CHAINS.map((c) => c.id) })
    const err = (await read().catch((e: unknown) => e)) as Error
    expect(err).not.toBeInstanceOf(PartialRead)
    for (const chain of CHAINS) expect(err.message).toContain(chain.name)
  })

  test('a token list nobody could fetch names the chains it left unread', async () => {
    stubChains({ tokens: [], listDown: true })
    const err = (await read().catch((e: unknown) => e)) as Error
    for (const chain of CHAINS) expect(err.message).toContain(chain.name)
  })

  test('chains a list failed for the same reason are one line naming them, not one each', async () => {
    stubChains({ tokens: everywhere('USDC'), listDown: true })
    const own = `https://own-list-${run}.invalid/list.json`
    process.env['TULA_ETHEREUM_TOKEN_LIST'] = own
    const stubbed = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) =>
      url === own
        ? new Response(JSON.stringify({ tokens: everywhere('USDC') }), { status: 200 })
        : stubbed(url, init)) as unknown as typeof fetch
    const err = (await read().catch((e: unknown) => e)) as PartialRead
    expect(err).toBeInstanceOf(PartialRead)
    const rest = CHAINS.filter((c) => c.id !== 'ethereum').map((c) => c.name)
    expect(err.failures).toEqual([
      `tula cannot tell which ERC-20s to ask about on ${rest.slice(0, -1).join(', ')} and ${rest.at(-1)}: ` +
        `the list at tokens-${run}.invalid returned HTTP 503.\n` +
        '  Set TULA_TOKEN_LIST to another Token Lists URL, or retry with /refresh.',
    ])
    // Ethereum is the chain a row names by leaving `chain` off.
    expect(err.positions.length).toBeGreaterThan(0)
    expect(err.positions.every((p) => p.chain === undefined)).toBe(true)
  })

  test('a list that is not a token list is named as that, never read as an empty wallet', async () => {
    for (const body of ['<html>', '{"tokens":{}}', '{}']) {
      stubChains({ tokens: [], listBody: body })
      const err = (await read().catch((e: unknown) => e)) as Error
      expect(err).not.toBeInstanceOf(PartialRead)
      expect(err.message).toContain('is not a token list')
      for (const chain of CHAINS) expect(err.message).toContain(chain.name)
    }
  })

  test('a balance that failed to read fails its chain rather than vanishing', async () => {
    const eth = at(1, 1)
    stubChains({
      tokens: [{ chainId: 1, address: eth, symbol: 'DAI', decimals: 18 }],
      balances: { [eth.toLowerCase()]: undefined as unknown as bigint },
    })
    const err = (await read().catch((e: unknown) => e)) as PartialRead
    expect(err.failures[0]).toMatch(/Ethereum node did not return balances/)
  })
})

describe('a held token is scaled by its own decimals, not the list’s', () => {
  const eth = at(1, 1)

  test('where the list is wrong the contract wins, and the read is still complete', async () => {
    // 6-decimal USDC listed at 18 reads 1,000 USDC as 0.000000001. The figure
    // is the chain's either way, so no failure is raised about the list.
    stubChains({
      tokens: [{ chainId: 1, address: eth, symbol: 'TKN', decimals: 18 }],
      balances: { [eth]: 1000n * 10n ** 6n },
      decimals: { [eth]: 6 },
    })
    expect((await read()).find((p) => p.asset === 'TKN')?.quantity.toString()).toBe('1000')
  })

  test('a contract that agrees, or that does not answer, changes nothing and reports nothing', async () => {
    const other = at(1, 2)
    stubChains({
      tokens: [
        { chainId: 1, address: eth, symbol: 'TKN', decimals: 6 },
        { chainId: 1, address: other, symbol: 'OLD', decimals: 6 },
      ],
      balances: { [eth]: 5n * 10n ** 6n, [other]: 7n * 10n ** 6n },
      decimals: { [eth]: 6, [other]: null },
    })
    const rows = await read()
    expect(rows.find((p) => p.asset === 'TKN')?.quantity.toString()).toBe('5')
    expect(rows.find((p) => p.asset === 'OLD')?.quantity.toString()).toBe('7')
  })

  test('an answer past what a uint256 can be scaled by is not taken over the list', async () => {
    stubChains({
      tokens: [{ chainId: 1, address: eth, symbol: 'TKN', decimals: 6 }],
      balances: { [eth]: 5n * 10n ** 6n },
      decimals: { [eth]: 200 },
    })
    expect((await read()).find((p) => p.asset === 'TKN')?.quantity.toString()).toBe('5')
  })
})

describe('freshness is per chain', () => {
  test('a chain that answered late does not date the chains that answered first', async () => {
    // One node held back, so the stamps are separable at all. Without that the
    // three reads land in the same millisecond and every assertion below is
    // satisfied by a single `new Date()` for the whole book.
    const late = CHAINS[CHAINS.length - 1]!
    stubChains({ tokens: everywhere('USDC'), slow: { chain: late.id, ms: 25 } })
    const rows = await read()

    // Which chain a row came from is its venue label, which is the only thing
    // `breaks` has to say where to act.
    const stampsOn = (id: ChainId): number[] => {
      const venue = id === ETHEREUM.id ? 'wallet' : `wallet-${id}`
      return [...new Set(rows.filter((p) => p.venue === venue).map((p) => p.asOf.getTime()))]
    }
    const behind = stampsOn(late.id)
    expect(behind).toHaveLength(1)

    for (const chain of CHAINS) {
      if (chain.id === late.id) continue
      const stamps = stampsOn(chain.id)
      expect(stamps).toHaveLength(1)
      // Hoist `wallet.ts`'s `new Date()` out of the per-chain read and these go
      // equal: a node minutes behind is then published under the freshest
      // chain's time, and every aggregate inherits that instead of the oldest.
      expect(stamps[0]!).toBeLessThan(behind[0]!)
    }
  })
})

/**
 * Captured from the live feed by `scripts/capture-onchain.ts`. A count written
 * by hand here would only be the code retyped; this is the feed's own answer,
 * and it is what fails when the default list stops covering a chain tula claims.
 */
describe('the list tula ships really does cover every chain tula reads', () => {
  const captured = (id: ChainId) =>
    JSON.parse(
      readFileSync(new URL(`../../fixtures/chains/${id}.json`, import.meta.url), 'utf8'),
    ) as { tokenList: { url: string; tokens: number; stablecoins: { symbol: string }[] } }

  for (const chain of CHAINS) {
    test(`${chain.name} has tokens on the feed tula defaults to`, () => {
      const { tokenList } = captured(chain.id)
      expect(tokenList.url).toBe(chain.defaultTokenList)
      expect(tokenList.tokens).toBeGreaterThan(0)
    })
  }

  test('the feed itself spells the bridged stablecoins apart from the ones they are named after', () => {
    // If it ever stopped, both would arrive as `USDC`, `contested` would
    // qualify each by its contract address, and neither would be priced.
    const arbitrum = captured('arbitrum').tokenList.stablecoins.map((s) => s.symbol)
    expect(arbitrum).toContain('USDC')
    expect(arbitrum).toContain('USDC.e')
    const base = captured('base').tokenList.stablecoins.map((s) => s.symbol)
    expect(base).toContain('USDC')
    expect(base).toContain('USDbC')
  })

  for (const chain of CHAINS) {
    test(`${chain.name}: every frontend skipped states the supply of the contract it answers for`, () => {
      // The day Monerium splits the ledgers, skipping the frontend drops a
      // balance, and this is what says so.
      const pairs = Object.keys(LEDGER_FRONTENDS).filter((at) => at.startsWith(`${chain.eip155}:`))
      const { sharedLedgers } = captured(chain.id) as unknown as {
        sharedLedgers: { frontendSupply: string; currentSupply: string }[]
      }
      expect(sharedLedgers).toHaveLength(pairs.length)
      for (const ledger of sharedLedgers) {
        expect(BigInt(ledger.currentSupply)).toBeGreaterThan(0n)
        expect(ledger.frontendSupply).toBe(ledger.currentSupply)
      }
    })
  }
})

// Written to be broken by progress: reading one of these means deleting its
// line from `coverage.doesNotRead` in the same change.
describe('the gaps this connector declares are still gaps', () => {
  const gap = (fragment: string): void => {
    expect((walletConnector.coverage?.doesNotRead ?? []).some((g) => g.what.includes(fragment))).toBe(
      true,
    )
  }

  test('a staking token off the list is declared unread, and reports nothing at all', async () => {
    gap('liquid staking')
    // The default Token Lists feed names none of them, and this connector asks
    // about exactly what the list names — so 100 stETH is silence, not a row.
    stubChains({ tokens: everywhere('DAI', 18) })
    expect((await read()).some((p) => p.asset === 'STETH')).toBe(false)
  })

  test('an LP token is declared opaque, and the pair inside it never becomes exposure', async () => {
    gap('LP or vault receipt token')
    stubChains({ tokens: [{ chainId: 1, address: at(1, 7), symbol: 'UNI-V2', decimals: 18 }] })
    // The one row beside native ETH is the pool token itself. Nothing reads the
    // reserves behind it, so an LP position holding ETH contributes no ETH.
    const rows = await read()
    expect(rows.filter((p) => p.venue === 'wallet').map((p) => p.asset)).toEqual(['ETH', 'UNI-V2'])
  })

  test('anything that is not an ERC-20 is declared unread, and only balanceOf goes out beside decimals', async () => {
    gap('NFTs')
    const tokens = everywhere('DAI', 18)
    const empty = tokens[0]!.address.toLowerCase()
    stubChains({ tokens, balances: { [empty]: 0n } })
    await read()
    expect(new Set(asked.map((a) => a.selector))).toEqual(new Set([SELECTOR.balanceOf, SELECTOR.decimals]))
    // Decimals are asked of what is held, never of every token on the list.
    expect(asked.some((a) => a.selector === SELECTOR.decimals && a.to === empty)).toBe(false)
  })

  test('Solana and HyperEVM are declared unread, and no node outside the registry is reached', async () => {
    gap('Solana')
    gap('HyperEVM')
    stubChains({ tokens: everywhere('DAI', 18) })
    await read()
    const nodes = new Set(asked.map((a) => a.node))
    expect(nodes.size).toBe(CHAINS.length)
    // HyperEVM is 999. It is not here, and the day it is, the gap above goes.
    expect(CHAINS.map((c) => c.eip155)).toEqual([1, 42161, 8453, 137, 10, 43114, 100, 534352, 59144])
  })
})
