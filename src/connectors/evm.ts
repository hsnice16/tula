import { TulaError } from '../core/errors.js'
import { host, request } from '../core/http.js'

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/

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

/** ABI-encoded string: offset, length, then the bytes. */
export function decodeString(hex: string): string {
  const body = hex.replace(/^0x/, '')
  if (body.length < 128) return ''
  const declared = Number(BigInt(`0x${body.slice(64, 128)}`))
  const length = Math.min(declared, MAX_SYMBOL_BYTES)
  const bytes = body.slice(128, 128 + length * 2)
  return (
    Buffer.from(bytes, 'hex')
      .toString('utf8')
      .replace(/\0+$/, '')
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .trim()
  )
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
    if (!res.ok) throw new TulaError(`The Ethereum node at ${host(rpcUrl)} returned HTTP ${res.status}.`)

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
  if (!result) throw new TulaError(`RPC call to ${call.to} returned nothing.`)
  return result
}

/** Native balance. `eth_call` cannot read it — it is account state, not a contract. */
export async function ethGetBalance(rpcUrl: string, address: string): Promise<bigint> {
  const res = await request(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'tula' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
  })
  if (!res.ok) throw new TulaError(`The Ethereum node at ${host(rpcUrl)} returned HTTP ${res.status}.`)
  const parsed = (await res.json()) as { result?: string; error?: { message: string } }
  if (parsed.error) throw new TulaError(`The Ethereum node at ${host(rpcUrl)} refused the call: ${parsed.error.message}`)
  return parsed.result ? BigInt(parsed.result) : 0n
}
