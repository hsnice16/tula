import Decimal from 'decimal.js'
import { remote, TulaError } from '../core/errors.js'
import { host, Intercepted, REQUEST_TIMEOUT_MS, request, TooSlow } from '../core/http.js'
import { visible } from '../core/untrusted.js'
import { type Chain, failOver, rpcNodes, rpcRemedy, rpcUrl } from './chains.js'
import { keccak256Hex } from './keccak.js'

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/**
 * EIP-55: the checksum lives in which hex letters are capitalised, so an
 * address typed in one case carries none and can only be shape-checked.
 */
export function checksumAddress(address: string): string {
  const body = address.replace(/^0x/, '').toLowerCase()
  const hash = keccak256Hex(body)
  let out = '0x'
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    out += parseInt(hash[i]!, 16) >= 8 ? c.toUpperCase() : c
  }
  return out
}

/**
 * Refuses a mistyped address rather than reading somebody else's book under it.
 *
 * A mixed-case address is checked against its own checksum, which is what makes
 * a single wrong character detectable at all. All-lower and all-upper are
 * accepted because they are what most block explorers copy — there is no
 * checksum in them to disagree with, and refusing them would only teach people
 * to lower-case an address until it was accepted.
 */
export function addressProblem(address: string): string | null {
  if (!ADDRESS.test(address)) {
    return 'That is not an Ethereum address. It should be 0x followed by 40 hex characters.'
  }
  const body = address.slice(2)
  if (body === body.toLowerCase() || body === body.toUpperCase()) return null
  if (address !== checksumAddress(address)) {
    return (
      'That address does not match its own checksum, so at least one character is wrong.\n' +
      '  Copy it again from the source rather than retyping it.'
    )
  }
  return null
}

/** Well-known ERC-20 and Aave selectors, verified against mainnet. */
export const SELECTOR = {
  balanceOf: '0x70a08231',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  getUserAccountData: '0xbf92857c',
  getUserConfiguration: '0x4417a583',
  getReservesList: '0xd1946dbc',
  getReserveData: '0x35ea6a75',
  getUserEMode: '0xeddf1b79',
  // Liquid eMode's own views. `getEModeCategoryData` survives beside them as a
  // legacy shim on every pool tula reads, and its return is a dynamic struct
  // whose first word is an offset rather than a field — these two are static,
  // and between them answer everything without that trap.
  getEModeCategoryCollateralConfig: '0xb286f467',
  getEModeCategoryCollateralBitmap: '0xb0771dba',
} as const

/**
 * A small unsigned argument, left-padded like any other word. Aave's eMode
 * views take a category id, which `encodeAddress` cannot express.
 */
export const encodeUint = (selector: string, value: number): string =>
  `${selector}${value.toString(16).padStart(64, '0')}`

export const encodeAddress = (selector: string, address: string): string =>
  `${selector}${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`

export const words = (hex: string): string[] => {
  const body = hex.replace(/^0x/, '')
  return Array.from({ length: Math.floor(body.length / 64) }, (_, i) => body.slice(i * 64, i * 64 + 64))
}

export const toBigInt = (word: string | undefined): bigint => (word ? BigInt(`0x${word}`) : 0n)

/**
 * A raw on-chain integer as the quantity it stands for. `Decimal` all the way
 * down: the divisor is 10^18 on most tokens, which is past what a float holds
 * exactly, and a wallet balance that is off in its last places is a wrong number
 * that reads as a right one.
 */
export const scale = (raw: bigint, decimals: number): Decimal =>
  new Decimal(raw.toString()).div(new Decimal(10).pow(decimals))

export const wordToAddress = (word: string | undefined): string =>
  word ? `0x${word.slice(24)}` : '0x'

/**
 * The length prefix belongs to whoever answers as the RPC, so it does not get to
 * size the read. `symbol()` in `src/cli/session.ts` bounds what is then kept.
 */
const MAX_SYMBOL_BYTES = 32

const clean = (bytes: string): string =>
  visible(Buffer.from(bytes, 'hex').toString('utf8').replace(/\0+$/, '')).trim()

/**
 * ABI-encoded string: offset, length, then the bytes.
 *
 * A single 32-byte word is `bytes32` instead — what `symbol()` returned before
 * the string form settled, and what MKR still returns as an Aave v3 reserve.
 * Read as a dynamic string it decodes to nothing, which used to surface as the
 * placeholder `UNKNOWN` and would now fail the whole venue.
 */
export function decodeString(hex: string): string {
  const body = hex.replace(/^0x/, '')
  if (body.length === 64) return clean(body)
  if (body.length < 128) return ''
  const declared = Number(BigInt(`0x${body.slice(64, 128)}`))
  const length = Math.min(declared, MAX_SYMBOL_BYTES)
  return clean(body.slice(128, 128 + length * 2))
}

interface RpcCall {
  to: string
  data: string
}

interface RpcResponse {
  id: number
  result?: string
  error?: { message: string }
}

/**
 * One POST, to one named node, with no opinion about what to do when it fails.
 * The one place a node is named in a failure: every message here says which
 * chain it is about, because with three nodes behind one book "the node
 * returned HTTP 429" sends the reader to replace an endpoint that is answering.
 */
async function postTo(chain: Chain, url: string, body: unknown): Promise<unknown> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'tula' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new TulaError(`The ${chain.name} node at ${host(url)} returned HTTP ${res.status}.`)
  }
  return res.json()
}

/** A node answering for somewhere else. Its own class so nothing retries it. */
class WrongChain extends TulaError {}

/**
 * A read, against whichever node the chain is on, moved to the next one when
 * that node will not talk to us.
 *
 * Only transport is retried — a rate limit, a 5xx, a timeout, a dead host.
 * Everything below is an *answer*, and an answer tula distrusts is reported
 * rather than asked again somewhere quieter: rotating on a node that
 * contradicts itself would keep asking until one agreed, which is how a wrong
 * number gets found rather than caught. Every method sent here is a read, so a
 * retry cannot repeat an effect.
 */
async function onSomeNode<T>(chain: Chain, read: (url: string) => Promise<T>): Promise<T> {
  const nodes = rpcNodes(chain)
  let last = ''
  // Bounded by the list rather than by `failOver` alone: two reads of one chain
  // failing at once each get told there is somewhere to go, and without a
  // ceiling the pair of them could hand the turn back and forth.
  for (let attempt = nodes.length; attempt > 0; attempt--) {
    const url = rpcUrl(chain)
    try {
      return await read(url)
    } catch (err) {
      // Neither is a node that would not talk. A captive portal or an
      // intercepting proxy answers for every node, so rotating past one only
      // replaces the message saying the network is rewriting traffic; and a
      // node that says it is another chain has answered, wrongly and clearly.
      if (err instanceof Intercepted || err instanceof WrongChain) throw err
      last =
        err instanceof TooSlow
          ? `The ${chain.name} node at ${host(url)} did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.`
          : err instanceof TulaError
            ? err.message
            : `The ${chain.name} node at ${host(url)} could not be reached: ` +
              remote(err instanceof Error ? err.message : String(err))
    }
    if (attempt === 1 || !failOver(chain, url)) break
  }
  // Counted, because "the node returned HTTP 429" read against three of them is
  // advice to go and replace one that was never the problem.
  const others = nodes.length - 1
  throw new TulaError(
    last +
      (others > 0 ? ` The other ${others} tula has did not answer either.` : '') +
      rpcRemedy(chain),
  )
}

const post = (chain: Chain, body: unknown): Promise<{ url: string; parsed: unknown }> =>
  onSomeNode(chain, async (url) => {
    const parsed = await postTo(chain, url, body)
    // Before a single row is read off it, and here rather than at each call
    // site: a rate limit moves a chain onto a node nothing has vouched for, and
    // the whole point of the check is that such a node answers plausibly.
    await confirmChain(chain, url)
    return { url, parsed }
  })

/**
 * What each node URL said it was, for as long as the process runs. A chain id
 * is a fact about the endpoint, not about the read, so asking twice buys
 * nothing — and a refresh that costs one extra round trip per chain is a
 * refresh people stop running.
 *
 * The promise is cached rather than the answer: a wallet read starts three
 * calls on one chain at once, and holding only settled answers had all three
 * miss and send the same `eth_chainId`.
 */
const identified = new Map<string, Promise<number>>()

function chainId(chain: Chain, url: string): Promise<number> {
  let asking = identified.get(url)
  if (!asking) {
    asking = postTo(chain, url, { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }).then(
      (answer) => {
        const parsed = answer as { result?: string; error?: { message: string } }
        if (parsed.error) {
          throw new TulaError(
            `The ${chain.name} node at ${host(url)} would not say which chain it is: ` +
              remote(parsed.error.message),
          )
        }
        if (!parsed.result) {
          throw new TulaError(`The ${chain.name} node at ${host(url)} did not say which chain it is.`)
        }
        return Number(BigInt(parsed.result))
      },
    )
    identified.set(url, asking)
  }
  // Dropped on failure so a node that was merely busy when it was first asked
  // is not remembered as one that can never prove itself.
  return asking.catch((err: unknown) => {
    identified.delete(url)
    throw err
  })
}

/**
 * Refuses a node that is not the chain it was configured as.
 *
 * This is the failure with nothing wrong-looking about it: token lists are
 * filtered per chain, and `eth_call` to an address holding no code answers
 * `0x` rather than an error — so an Arbitrum list read against an Ethereum
 * node returns a zero for every token and the chain is reported as an empty
 * wallet. Every other guard here is about a node that answers badly; this one
 * is about a node that answers confidently for somewhere else.
 *
 * Takes the node rather than the chain because a rate limit moves a chain
 * mid-read: the node that answered a batch is the node that has to prove
 * itself, not whichever one the chain has rotated to since.
 */
async function confirmChain(chain: Chain, url: string): Promise<void> {
  const seen = await chainId(chain, url)
  if (seen !== chain.eip155) {
    throw new WrongChain(
      `The node at ${host(url)} set for ${chain.name} answers for chain ${seen}, not ` +
        `${chain.eip155}. Every balance read through it would be a different chain's.` +
        rpcRemedy(chain),
    )
  }
}

/**
 * Rotates as any other read does, and is often the first call of one: a chain
 * whose first node is rate-limiting would otherwise fail here, on the one call
 * that runs before anything else could move it.
 */
export const assertChain = (chain: Chain): Promise<void> =>
  onSomeNode(chain, (url) => confirmChain(chain, url))

/**
 * Public RPCs reject very large batches, so calls go out in chunks. Order is
 * restored by id: a batch response may come back in any order.
 */
export const BATCH_SIZE = 40

export async function ethCallBatch(
  chain: Chain,
  calls: RpcCall[],
  chunkSize = BATCH_SIZE,
): Promise<Array<string | null>> {
  const out: Array<string | null> = new Array(calls.length).fill(null)

  for (let start = 0; start < calls.length; start += chunkSize) {
    const chunk = calls.slice(start, start + chunkSize)
    const body = chunk.map((call, i) => ({
      jsonrpc: '2.0',
      id: start + i,
      method: 'eth_call',
      params: [{ to: call.to, data: call.data }, 'latest'],
    }))

    const { url, parsed } = (await post(chain, body)) as {
      url: string
      parsed: RpcResponse[] | RpcResponse
    }
    // Before a single answer is read, not after the loop: a rate limit can move
    // the chain onto a node nothing has vouched for, and the whole point of the
    // check is that a node answering for the wrong chain answers plausibly.
    await confirmChain(chain, url)

    // A batch answered by a single object is not an answer to the batch: nodes
    // reply that way to reject the whole request, and read as one row it left
    // every call in the chunk null — forty balances missing behind one message
    // nobody printed.
    if (!Array.isArray(parsed)) {
      throw new TulaError(
        `The ${chain.name} node at ${host(url)} refused a batch of ${chunk.length} calls` +
          `${parsed.error ? `: ${remote(parsed.error.message)}` : '.'}` +
          rpcRemedy(chain),
      )
    }

    // The id is the only thing tying an answer to the call that asked, and it
    // is chosen by whoever answers. An id repeated, or one from outside this
    // chunk, files one token's balance under another token's row — a wrong
    // number with nothing about it that looks wrong.
    const seen = new Set<number>()
    for (const row of parsed) {
      if (typeof row.id !== 'number' || row.id < start || row.id >= start + chunk.length) {
        throw new TulaError(
          `The ${chain.name} node at ${host(url)} answered a call tula did not make.` +
            rpcRemedy(chain),
        )
      }
      if (seen.has(row.id)) {
        throw new TulaError(
          `The ${chain.name} node at ${host(url)} answered one call twice, so tula cannot ` +
            'tell which answer belongs to which token.' +
            rpcRemedy(chain),
        )
      }
      seen.add(row.id)
      if (row.error) continue
      if (row.result) out[row.id] = row.result
    }
  }

  return out
}

export async function ethCall(chain: Chain, call: RpcCall): Promise<string> {
  const [result] = await ethCallBatch(chain, [call])
  if (!result) {
    throw new TulaError(
      `The ${chain.name} node answered nothing for a call to ${call.to.slice(0, 10)}….` +
        rpcRemedy(chain),
    )
  }
  return result
}

/** Native balance. `eth_call` cannot read it — it is account state, not a contract. */
export async function ethGetBalance(chain: Chain, address: string): Promise<bigint> {
  const { url, parsed: answer } = await post(chain, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
  })
  // Same reason as the batch: a balance is only worth reading once the node
  // that gave it has said which chain it is.
  await confirmChain(chain, url)
  const parsed = answer as { result?: string; error?: { message: string } }
  if (parsed.error) {
    throw new TulaError(
      `The ${chain.name} node at ${host(url)} refused the call: ${remote(parsed.error.message)}` +
        rpcRemedy(chain),
    )
  }
  // No result and no error is not a balance of zero. Answered as one it reads
  // as an empty wallet, which is the one thing an unreachable node must never
  // be able to say.
  if (!parsed.result) {
    throw new TulaError(
      `The ${chain.name} node at ${host(url)} returned no balance for ${address.slice(0, 10)}….` +
        rpcRemedy(chain),
    )
  }
  return BigInt(parsed.result)
}
