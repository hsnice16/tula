import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CHAINS, ETHEREUM, resetRotation, rpcNodes, rpcUrl, type Chain } from './chains.js'
import {
  assertChain,
  BATCH_SIZE,
  decodeString,
  encodeAddress,
  ethCallBatch,
  ethGetBalance,
  scale,
  SELECTOR,
  toBigInt,
  wordToAddress,
  words,
} from './evm.js'

describe('ABI helpers', () => {
  test('encodes an address left-padded to 32 bytes', () => {
    expect(encodeAddress(SELECTOR.balanceOf, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')).toBe(
      '0x70a08231000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    )
  })

  test('splits a return value into 32-byte words', () => {
    expect(words(`0x${'11'.repeat(32)}${'22'.repeat(32)}`)).toHaveLength(2)
  })

  test('reads an address out of its right-hand 20 bytes', () => {
    expect(wordToAddress(`${'0'.repeat(24)}c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`)).toBe(
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    )
  })

  test('a missing word is zero, not NaN', () => {
    expect(toBigInt(undefined)).toBe(0n)
  })

  test('decodes an ABI string past its offset and length', () => {
    // offset, length 4, then "WETH" right-padded
    const hex =
      '0x' +
      '20'.padStart(64, '0') +
      '4'.padStart(64, '0') +
      Buffer.from('WETH').toString('hex').padEnd(64, '0')
    expect(decodeString(hex)).toBe('WETH')
  })

  test('a too-short string returns empty rather than throwing', () => {
    expect(decodeString('0x00')).toBe('')
  })

  // Whoever answers as the RPC chooses both the length prefix and the bytes.
  const encode = (text: string, declaredBytes = Buffer.byteLength(text)) => {
    const body = Buffer.from(text, 'utf8').toString('hex')
    const pad = (n: number) => n.toString(16).padStart(64, '0')
    return `0x${pad(32)}${pad(declaredBytes)}${body.padEnd(Math.ceil(body.length / 64) * 64, '0')}`
  }

  test('a symbol longer than any real one is cut, not passed through', () => {
    const long = 'A'.repeat(500)
    expect(decodeString(encode(long)).length).toBe(32)
  })

  test('a length prefix that lies about the payload does not over-read', () => {
    expect(decodeString(encode('WETH', 4096))).toBe('WETH')
  })

  test('control characters and line breaks are stripped', () => {
    expect(decodeString(encode('WE\nTH\u0000\u202e'))).toBe('WETH')
  })
})

const original = globalThis.fetch

/**
 * A node with no environment override, so a shell that already exports one of
 * the real names cannot move a test's node out from under it. Counted, so each
 * describe below gets a URL nothing has answered for yet — `assertChain` caches
 * what a URL said it was, and a second test reusing a URL would skip the check
 * it exists to make.
 */
let nodes = 0
let NODE: Chain
let RPC: string
beforeEach(() => {
  RPC = `https://node-${++nodes}.invalid/rpc`
  NODE = { ...ETHEREUM, rpcEnv: [], defaultRpcs: [RPC] }
  // Rotation is per process: a test that leaves a chain on its second node
  // moves the node out from under the next one, which then passes for the
  // wrong reason.
  resetRotation()
})

/**
 * Whatever the node is made to answer, verbatim — the id included.
 *
 * `eth_chainId` is the exception, and answers truthfully: every read confirms
 * the node that answered it before a row is taken off it, so a stub returning
 * the test's own body to that call too would fail each test below on the
 * identity check rather than on the thing it is about.
 */
function answers(body: unknown): void {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const sent: unknown = JSON.parse(String(init.body))
    if (!Array.isArray(sent) && (sent as { method?: string }).method === 'eth_chainId') {
      const chain = CHAINS.find((c) => c.defaultRpcs.includes(url))
      return identity(chain?.eip155 ?? ETHEREUM.eip155)
    }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof fetch
}

const identity = (eip155: number): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${eip155.toString(16)}` }), {
    status: 200,
  })

/** The node's own answer about which chain it is, stubbed rather than routed. */
function identifiesAs(body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
}

/** Built rather than written out: a 40-hex literal reads as somebody's address. */
const contract = (n: number): string => `0x${n.toString().repeat(40).slice(0, 40)}`

const three = [1, 2, 3].map((n) => ({ to: contract(n), data: SELECTOR.symbol }))

const result = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`

afterEach(() => {
  globalThis.fetch = original
})

describe('a batch answer is only trusted as far as its ids', () => {
  test('answers are placed by id, whatever order they come back in', async () => {
    answers([
      { id: 2, result: result(3) },
      { id: 0, result: result(1) },
      { id: 1, result: result(2) },
    ])
    expect(await ethCallBatch(NODE, three)).toEqual([result(1), result(2), result(3)])
  })

  test('one call answered twice fails rather than filing a balance under the wrong token', async () => {
    // The second answer overwrote the first and one call was left null, so a
    // token nobody asked about set the row for a token somebody holds.
    answers([
      { id: 0, result: result(1) },
      { id: 0, result: result(99) },
      { id: 2, result: result(3) },
    ])
    await expect(ethCallBatch(NODE, three)).rejects.toThrow(/answered one call twice/)
  })

  test('an id from outside the chunk fails rather than landing in another chunk’s row', async () => {
    answers([{ id: 41, result: result(1) }])
    await expect(ethCallBatch(NODE, three)).rejects.toThrow(/did not make/)
  })

  test('a whole batch refused in one object is not forty silent nulls', async () => {
    // A node rejecting the request answers with a single error object rather
    // than a row per call. Read as one row it left every call in the chunk
    // unanswered, with nothing to say the node had refused.
    answers({ jsonrpc: '2.0', id: null, error: { message: 'batch too large' } })
    await expect(ethCallBatch(NODE, three)).rejects.toThrow(/refused a batch of 3 calls/)
  })

  test('a single call that reverts is still an answer about that call alone', async () => {
    answers([
      { id: 0, error: { message: 'execution reverted' } },
      { id: 1, result: result(2) },
      { id: 2, result: result(3) },
    ])
    expect(await ethCallBatch(NODE, three)).toEqual([null, result(2), result(3)])
  })
})

describe('a node is never trusted about which chain it is', () => {
  test('a node answering for another chain fails rather than reading as an empty wallet', async () => {
    // The quiet one: token lists are filtered per chain, and an `eth_call` to
    // an address holding no code answers `0x` rather than an error — so an
    // Arbitrum list read against an Ethereum node returns a zero for every
    // token and the whole chain is reported as holding nothing.
    identifiesAs({ jsonrpc: '2.0', id: 1, result: '0xa4b1' })
    await expect(assertChain(NODE)).rejects.toThrow(/answers for chain 42161, not 1/)
  })

  test('a node that is the chain it was configured as is accepted', async () => {
    identifiesAs({ jsonrpc: '2.0', id: 1, result: '0x1' })
    await expect(assertChain(NODE)).resolves.toBeUndefined()
  })

  test('a node that will not say which chain it is fails rather than being assumed', async () => {
    identifiesAs({ jsonrpc: '2.0', id: 1 })
    await expect(assertChain(NODE)).rejects.toThrow(/did not say which chain/)
  })
})

describe('a failure names the chain it happened on', () => {
  const failed = async (chain: Chain): Promise<string> => {
    answers({ jsonrpc: '2.0', id: null, error: { message: 'rate limited' } })
    return ethCallBatch(chain, three).then(
      () => '',
      (err: Error) => err.message,
    )
  }

  test('the chain and its own RPC variable are named, not Ethereum’s', async () => {
    // Every RPC failure used to open "The Ethereum node" and end by naming
    // TULA_ETH_RPC. On a book reading three nodes that sends the reader to
    // replace an endpoint that is answering.
    for (const chain of CHAINS) {
      const message = await failed(chain)
      expect(message).toContain(chain.name)
      expect(message).toContain(chain.rpcEnv[0]!)
    }
  })

  test('no two chains offer the reader the same variable to change', () => {
    expect(new Set(CHAINS.map((c) => c.rpcEnv[0])).size).toBe(CHAINS.length)
  })
})

describe('every chain has a node, and every node can be pointed elsewhere', () => {
  const saved = new Map(
    CHAINS.flatMap((c) => c.rpcEnv).map((name) => [name, process.env[name]] as const),
  )
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  test('each chain ships a public default, so none of them needs configuring', () => {
    for (const name of saved.keys()) delete process.env[name]
    for (const chain of CHAINS) expect(rpcUrl(chain)).toBe(chain.defaultRpcs[0]!)
  })

  test('each chain’s node is overridable on its own, without moving the others', () => {
    for (const chain of CHAINS) {
      for (const name of saved.keys()) delete process.env[name]
      process.env[chain.rpcEnv[0]!] = 'https://mine.invalid/rpc'
      for (const other of CHAINS) {
        expect(rpcUrl(other)).toBe(
          other === chain ? 'https://mine.invalid/rpc' : other.defaultRpcs[0]!,
        )
      }
    }
  })

  test('TULA_ETH_RPC still points Ethereum, so a dotfile that has it is not ignored', () => {
    // It is the name the one-chain release shipped. Silently dropping a
    // variable somebody already exports is the wrong way for a rename to fail:
    // the node moves back to the public default and nothing says so.
    for (const name of saved.keys()) delete process.env[name]
    process.env['TULA_ETH_RPC'] = 'https://old.invalid/rpc'
    expect(rpcUrl(ETHEREUM)).toBe('https://old.invalid/rpc')
  })

  test('the new name wins over the old one, so setting both is not ambiguous', () => {
    process.env['TULA_ETH_RPC'] = 'https://old.invalid/rpc'
    process.env['TULA_ETHEREUM_RPC'] = 'https://new.invalid/rpc'
    expect(rpcUrl(ETHEREUM)).toBe('https://new.invalid/rpc')
  })
})

/**
 * Captured from the public nodes themselves by `scripts/capture-onchain.ts`.
 * A default RPC pointed at the wrong chain is the failure with nothing
 * wrong-looking about it, and this is the only thing in the repo that can
 * contradict the registry about it — a hand-written number here would just be
 * the registry retyped.
 */
describe('the node each chain ships is the chain it claims to be', () => {
  for (const chain of CHAINS) {
    const captured = JSON.parse(
      readFileSync(new URL(`../../fixtures/chains/${chain.id}.json`, import.meta.url), 'utf8'),
    ) as { nodes: Array<{ rpc: string; chainId: string; batchAnswered: number }> }

    test(`${chain.name} ships every node the capture asked, and no other`, () => {
      // A node in the registry that nothing has ever contacted is the whole
      // failure this describe exists to catch, and a list that has grown since
      // the capture would otherwise let one through untested.
      expect(captured.nodes.map((n) => n.rpc)).toEqual([...chain.defaultRpcs])
    })

    for (const index of chain.defaultRpcs.keys()) {
      const seen = captured.nodes[index]!

      test(`${chain.name}'s node ${index + 1} answered for chain ${chain.eip155}`, () => {
        expect(Number(BigInt(seen.chainId))).toBe(chain.eip155)
      })

      test(`${chain.name}'s node ${index + 1} answers a batch of ${BATCH_SIZE}`, () => {
        // Every call here goes out as an array, so a node that answers one call
        // and rejects a batch is one no read in this tool works against — and a
        // node that quietly caps the batch lower is one that refuses whole
        // chunks the moment a chain rotates onto it.
        expect(seen.batchAnswered).toBe(BATCH_SIZE)
      })
    }
  }
})

describe('a chain moves to its next node rather than losing the read', () => {
  /**
   * Three nodes with no environment override, so a shell exporting one of the
   * real names cannot move them, and each test gets URLs nothing has answered
   * for yet — a node's chain id is cached by URL for the life of the process.
   */
  let TRIO: Chain
  let urls: string[]
  beforeEach(() => {
    urls = [1, 2, 3].map((n) => `https://trio-${nodes}-${n}.invalid/rpc`)
    TRIO = { ...ETHEREUM, rpcEnv: [], defaultRpcs: urls }
  })

  /** Which node each call reached, in order, and what each of them said back. */
  function nodesAnswer(reply: (url: string) => Response): string[] {
    const reached: string[] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const sent: unknown = JSON.parse(String(init.body))
      if (!Array.isArray(sent) && (sent as { method?: string }).method === 'eth_chainId') {
        return identity(ETHEREUM.eip155)
      }
      reached.push(url)
      return reply(url)
    }) as unknown as typeof fetch
    return reached
  }

  const rows = (): Response =>
    new Response(JSON.stringify(three.map((_, i) => ({ id: i, result: result(i + 1) }))), {
      status: 200,
    })

  test('a rate-limited node costs a retry, not the chain', async () => {
    const reached = nodesAnswer((url) =>
      url === urls[0] ? new Response('slow down', { status: 429 }) : rows(),
    )
    expect(await ethCallBatch(TRIO, three)).toEqual([result(1), result(2), result(3)])
    expect(reached).toEqual([urls[0]!, urls[1]!])
  })

  test('the chain stays on the node that answered, rather than starting over', async () => {
    // Retrying the busy one first on every batch spends a round trip to be
    // refused again — and, since a batch is chunked, reads half a book from one
    // node and half from another at two different block heights.
    const reached = nodesAnswer((url) =>
      url === urls[0] ? new Response('slow down', { status: 429 }) : rows(),
    )
    await ethCallBatch(TRIO, three)
    await ethCallBatch(TRIO, three)
    expect(reached).toEqual([urls[0]!, urls[1]!, urls[1]!])
  })

  test('every node failing is a failure, not an empty answer', async () => {
    nodesAnswer(() => new Response('slow down', { status: 429 }))
    const message = await ethCallBatch(TRIO, three).then(
      () => '',
      (err: Error) => err.message,
    )
    // Named, and counted: "the node returned HTTP 429" read against three of
    // them is advice to go and replace one that was never the problem.
    expect(message).toContain(urls[2]!.replace('https://', '').replace('/rpc', ''))
    expect(message).toContain('The other 2 tula has did not answer either.')
  })

  test('a node the chain rotates onto still has to say which chain it is', async () => {
    // The check exists because a node answering for another chain answers
    // plausibly — every balance comes back zero. A fallback reached only when
    // the first node is busy is exactly where an unchecked one would hide.
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const sent: unknown = JSON.parse(String(init.body))
      if (url === urls[0]) return new Response('slow down', { status: 429 })
      if (!Array.isArray(sent) && (sent as { method?: string }).method === 'eth_chainId') {
        return identity(42161)
      }
      return rows()
    }) as unknown as typeof fetch
    await expect(ethCallBatch(TRIO, three)).rejects.toThrow(/answers for chain 42161, not 1/)
  })

  test('a node that answers badly is reported, not asked again somewhere quieter', async () => {
    // A rotation here would keep asking until one node agreed, which is how a
    // wrong number gets found rather than caught.
    const reached = nodesAnswer(
      () => new Response(JSON.stringify([{ id: 0, result: result(1) }, { id: 0, result: result(2) }]), { status: 200 }),
    )
    await expect(ethCallBatch(TRIO, three)).rejects.toThrow(/answered one call twice/)
    expect(reached).toEqual([urls[0]!])
  })
})

describe('an override says which nodes the address may be exposed to', () => {
  const saved = new Map(
    CHAINS.flatMap((c) => c.rpcEnv).map((name) => [name, process.env[name]] as const),
  )
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  test('a variable naming several nodes is the whole list, in that order', () => {
    process.env['TULA_ETHEREUM_RPC'] = ' https://mine.invalid/a , https://mine.invalid/b '
    expect(rpcNodes(ETHEREUM)).toEqual([
      'https://mine.invalid/a',
      'https://mine.invalid/b',
    ])
  })

  test('the public nodes are not appended to an override that is busy', () => {
    // Somebody who points a chain at their own node has said which nodes they
    // are willing to show the address to. Falling back past that list would
    // answer a privacy decision on their behalf.
    process.env['TULA_ETHEREUM_RPC'] = 'https://mine.invalid/only'
    expect(rpcNodes(ETHEREUM)).toHaveLength(1)
  })
})

describe('a native balance nobody answered is not a balance of zero', () => {
  test('no result and no error fails rather than reporting an empty wallet', async () => {
    answers({ jsonrpc: '2.0', id: 1 })
    await expect(
      ethGetBalance(NODE, '0x0000000000000000000000000000000000000abc'),
    ).rejects.toThrow(/no balance/)
  })

  test('a balance that did answer is read', async () => {
    answers({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' })
    expect(await ethGetBalance(NODE, '0x0000000000000000000000000000000000000abc')).toBe(10n ** 18n)
  })
})

describe('balance scaling', () => {
  test('respects the token’s own decimals rather than assuming 18', () => {
    expect(scale(1_500_000n, 6).toString()).toBe('1.5')
    expect(scale(10n ** 18n, 18).toString()).toBe('1')
  })

  test('keeps precision a float would lose', () => {
    // float64 rounds this to 123.45678901234568. decimal.js carries 20
    // significant digits — its default, which this repo does not raise — so
    // wei-exact amounts past that ceiling round rather than overflow.
    expect(scale(123456789012345678901n, 18).toString()).toBe('123.4567890123456789')
  })
})
