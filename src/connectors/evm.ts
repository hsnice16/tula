import { remote, TulaError } from '../core/errors.js'
import { host, request } from '../core/http.js'
import { visible } from '../core/untrusted.js'
import { keccak256Hex } from './keccak.js'

/** Every RPC failure has the same two ways out, and neither is obvious. */
export const RPC_REMEDY = '\n  Retry with /refresh, or set TULA_ETH_RPC to another node.'

/** Read per call, not at import, so a test can point a connector somewhere else. */
export const ethRpcUrl = (): string =>
  process.env['TULA_ETH_RPC'] ?? 'https://ethereum-rpc.publicnode.com'

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
  getReservesList: '0xd1946dbc',
  getReserveData: '0x35ea6a75',
} as const

export const encodeAddress = (selector: string, address: string): string =>
  `${selector}${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`

export const words = (hex: string): string[] => {
  const body = hex.replace(/^0x/, '')
  return Array.from({ length: Math.floor(body.length / 64) }, (_, i) => body.slice(i * 64, i * 64 + 64))
}

export const toBigInt = (word: string | undefined): bigint => (word ? BigInt(`0x${word}`) : 0n)

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
 * Public RPCs reject very large batches, so calls go out in chunks. Order is
 * restored by id: a batch response may come back in any order.
 */
export async function ethCallBatch(
  rpcUrl: string,
  calls: RpcCall[],
  chunkSize = 40,
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

    const res = await request(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'tula' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new TulaError(
        `The Ethereum node at ${host(rpcUrl)} returned HTTP ${res.status}.` + RPC_REMEDY,
      )
    }

    const parsed = (await res.json()) as RpcResponse[] | RpcResponse
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    for (const row of rows) {
      if (row.error) continue
      if (typeof row.id === 'number' && row.result) out[row.id] = row.result
    }
  }

  return out
}

export async function ethCall(rpcUrl: string, call: RpcCall): Promise<string> {
  const [result] = await ethCallBatch(rpcUrl, [call])
  if (!result) {
    throw new TulaError(
      `The Ethereum node answered nothing for a call to ${call.to.slice(0, 10)}….` + RPC_REMEDY,
    )
  }
  return result
}

/** Native balance. `eth_call` cannot read it — it is account state, not a contract. */
export async function ethGetBalance(rpcUrl: string, address: string): Promise<bigint> {
  const res = await request(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'tula' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
  })
  if (!res.ok) {
    throw new TulaError(
      `The Ethereum node at ${host(rpcUrl)} returned HTTP ${res.status}.` + RPC_REMEDY,
    )
  }
  const parsed = (await res.json()) as { result?: string; error?: { message: string } }
  if (parsed.error) {
    throw new TulaError(
      `The Ethereum node at ${host(rpcUrl)} refused the call: ${remote(parsed.error.message)}` +
        RPC_REMEDY,
    )
  }
  return parsed.result ? BigInt(parsed.result) : 0n
}
