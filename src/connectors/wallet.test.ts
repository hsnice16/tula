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
  /** Balances, keyed by lower-cased contract. Anything unnamed answers 1e18. */
  balances?: Record<string, bigint>
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
      asked.push({ node: url, to, selector: call.params[0].data.slice(0, 10) })
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
      new Set(['wallet', 'wallet-arbitrum', 'wallet-base']),
    )
  })

  test('a chain is read against its own node, never another chain’s', async () => {
    stubChains({ tokens: everywhere('USDC') })
    await read()
    for (const chain of CHAINS) {
      const theirs = chainTokens(everywhere('USDC'), chain).map((t) => t.address.toLowerCase())
      const reached = asked.filter((a) => a.node === nodeOf.get(chain.id)).map((a) => a.to)
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
    const onBase = asked.filter((a) => a.node === nodeOf.get('base'))
    expect(onBase).toHaveLength(1)
    for (const other of ['ethereum', 'arbitrum'] as const) {
      expect(asked.filter((a) => a.node === nodeOf.get(other))).toHaveLength(0)
    }
  })
})

describe('one asset nets across chains; one position keeps its chain', () => {
  test('the same stablecoin on three chains is one asset, not three rows that never cancel', async () => {
    stubChains({ tokens: everywhere('USDC') })
    const rows = (await read()).filter((p) => p.asset === 'USDC')
    expect(rows).toHaveLength(3)
    // One asset id, so `netExposure` buckets them together and the book states
    // one USDC figure rather than three that each read as a separate holding.
    expect(new Set(rows.map((p) => p.asset)).size).toBe(1)
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
    stubChains({ tokens: everywhere('USDC') })
    const rows = (await read()).filter((p) => p.asset === 'USDC')
    expect(new Set(rows.map((p) => p.venue)).size).toBe(3)
    // And the ids stay distinct, or one chain's row overwrites another's.
    expect(new Set(rows.map((p) => p.id)).size).toBe(3)
  })

  test('native ETH on every chain is ETH, since all three settle gas in it', async () => {
    stubChains({ tokens: [] })
    const rows = await read()
    expect(rows.map((p) => p.asset)).toEqual(['ETH', 'ETH', 'ETH'])
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
        { chainId: arb.eip155, address: at(arb.eip155, 1), symbol: 'USDC', decimals: 6 },
        { chainId: arb.eip155, address: at(arb.eip155, 2), symbol: 'USDC.e', decimals: 6 },
      ],
    })
    const assets = (await read()).map((p) => p.asset)
    expect(assets).toContain('USDC')
    expect(assets).toContain('USDC.E')
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
    expect([...new Set(err.positions.map((p) => p.venue))].sort()).toEqual([
      'wallet',
      'wallet-base',
    ])
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
    stubChains({ tokens: everywhere('USDC'), down: ['ethereum', 'arbitrum', 'base'] })
    const err = (await read().catch((e: unknown) => e)) as Error
    expect(err).not.toBeInstanceOf(PartialRead)
    for (const chain of CHAINS) expect(err.message).toContain(chain.name)
  })

  test('a token list nobody could fetch names the chains it left unread', async () => {
    stubChains({ tokens: [], listDown: true })
    const err = (await read().catch((e: unknown) => e)) as Error
    for (const chain of CHAINS) expect(err.message).toContain(chain.name)
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

  test('anything that is not an ERC-20 is declared unread, and only balanceOf goes out', async () => {
    gap('NFTs')
    stubChains({ tokens: everywhere('DAI', 18) })
    await read()
    expect(new Set(asked.map((a) => a.selector))).toEqual(new Set([SELECTOR.balanceOf]))
  })

  test('Solana and HyperEVM are declared unread, and no node outside the three is reached', async () => {
    gap('Solana')
    gap('HyperEVM')
    stubChains({ tokens: everywhere('DAI', 18) })
    await read()
    const nodes = new Set(asked.map((a) => a.node))
    expect(nodes.size).toBe(CHAINS.length)
    expect(CHAINS.map((c) => c.eip155)).toEqual([1, 42161, 8453])
  })
})
