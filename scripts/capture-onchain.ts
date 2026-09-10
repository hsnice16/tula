#!/usr/bin/env bun
/**
 * Captures real responses from the public on-chain endpoints into `fixtures/`.
 *
 * Every connector test used to invent the venue's answer, so a test could only
 * ever confirm what we already believed: the Hyperliquid fixture omitted
 * `totalNtlPos` and so contained no right answer for `totalRawUsd` to be wrong
 * against. A captured response carries the venue's own arithmetic, which is the
 * only thing that can contradict us — see `describe('what Hyperliquid says
 * about itself')` in `src/connectors/hyperliquid.test.ts`.
 *
 *   bun scripts/capture-onchain.ts            # refresh every fixture
 *   bun scripts/capture-onchain.ts --scan 60  # look at more accounts
 *
 * Neither an address nor a real amount reaches a fixture. Each address is stood
 * a placeholder in, so a fixture relating two fields by address still relates
 * them; the chain fixtures drop addresses outright, because nothing asserted
 * against them is anything but a count, a symbol or a chain id.
 *
 * The amounts are multiplied by one factor per account, drawn in `factor()` and
 * written down nowhere: an address is only half of what identifies somebody, and
 * these accounts come from a follower list anybody can fetch, so an exact
 * balance is a lookup key. Everything the venue relates is degree one in those
 * amounts, and so survives the multiplication exactly — `accountValue =
 * totalRawUsd + Σ sign(szi) × positionValue`, and `liquidationPx`, which is the
 * mark price plus the spot USDC left after maintenance margin over the position
 * size. Rounding those figures off, or inventing them, holds none of it: what a
 * fixture cannot state, a test cannot catch us getting wrong, which is how a
 * build shipped reporting six figures of spendable USDC on an account worth five.
 */

import Decimal from 'decimal.js'
import { DEPLOYMENTS } from '../src/connectors/aave.js'
import { CHAINS, type Chain } from '../src/connectors/chains.js'
import { BATCH_SIZE, decodeString, SELECTOR, toBigInt, wordToAddress, words } from '../src/connectors/evm.js'
import type { TokenEntry } from '../src/connectors/wallet.js'

const INFO = 'https://api.hyperliquid.xyz/info'

/** Public, and named in Hyperliquid's own docs: the protocol's HLP vault. */
const HLP_VAULT = '0xdfc24b077bc1425ad1dea75bcb6f8158e10df303'

const OUT = new URL('../fixtures/', import.meta.url).pathname

const ADDRESS = /0x[0-9a-fA-F]{40}/g

/**
 * Its own pattern rather than `ADDRESS.test()`: a `/g` regex carries `lastIndex`
 * between calls, so testing the same string twice answers true then false.
 */
const isAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value)

async function info<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'tula-capture' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${JSON.stringify(body)} -> HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * One placeholder per distinct address, so a fixture that relates two fields by
 * address still relates them. Length and the `0x` prefix are preserved: a
 * shorter stand-in would pass a validity check the real value has to pass.
 */
function redact(value: unknown, seen = new Map<string, string>()): unknown {
  if (typeof value === 'string') {
    return value.replace(ADDRESS, (hit) => {
      const key = hit.toLowerCase()
      const known = seen.get(key)
      if (known) return known
      const stand = `0x${(seen.size + 1).toString(16).padStart(40, '0')}`
      seen.set(key, stand)
      return stand
    })
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, seen))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, seen)]),
    )
  }
  return value
}

/**
 * Wider than the 20 significant figures decimal.js multiplies to by default, so
 * a product is the venue's own figure scaled rather than a rounding of one.
 */
const Exact = Decimal.clone({ precision: 40 })

/**
 * The fields carrying an amount. Three do not read like one: `rawUsd` is the
 * margin inside an isolated position's `leverage`, and `allTime`, `sinceOpen`
 * and `sinceChange` are funding paid, named for their window not their unit.
 */
const AMOUNT = new Set([
  'accountValue',
  'totalNtlPos',
  'totalRawUsd',
  'totalMarginUsed',
  'crossMaintenanceMarginUsed',
  'withdrawable',
  'szi',
  'positionValue',
  'marginUsed',
  'unrealizedPnl',
  'rawUsd',
  'allTime',
  'sinceOpen',
  'sinceChange',
  'total',
  'hold',
  'entryNtl',
  'tokenToAvailableAfterMaintenance',
])

/**
 * The fields a factor must not touch. A price is per unit and does not move when
 * the units do; `returnOnEquity` and `liquidationPx` are already degree zero in
 * the amounts, so multiplying them is what would break them.
 */
const KEPT = new Set(['coin', 'entryPx', 'liquidationPx', 'returnOnEquity'])

const FIGURE = /^-?\d+(\.\d+)?$/

/**
 * Ten decimal places is inside what Hyperliquid itself returns, and leaves the
 * identities off by ~1e-10 against a tolerance of 1e-6.
 */
function figure(scaled: Decimal): string {
  const fixed = scaled.toDecimalPlaces(10, Decimal.ROUND_HALF_EVEN)
  // A dust row must not round to zero: a holding that disappears is a different
  // account, and the connector drops the row before any test sees it.
  return (fixed.isZero() && !scaled.isZero() ? scaled.toSignificantDigits(10) : fixed).toFixed()
}

/**
 * An unclassified figure stops the capture rather than being passed through: a
 * new field left unscaled would be a real amount in the fixture, and one scaled
 * by mistake — a price, a ratio — would leave the account describing nothing the
 * venue could have said.
 */
function scale(value: unknown, by: Decimal, key = ''): unknown {
  if (typeof value === 'string' && FIGURE.test(value)) {
    if (KEPT.has(key)) return value
    if (!AMOUNT.has(key)) throw new Error(`${key}: is it an amount? add it to AMOUNT or to KEPT`)
    const amount = new Exact(value).times(by)
    // Zero is zero at any scale, and leaving the string alone keeps the venue's
    // own `0.0` rather than a shape it never returns.
    return amount.isZero() ? value : figure(amount)
  }
  if (Array.isArray(value)) return value.map((v) => scale(v, by, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scale(v, by, k)]),
    )
  }
  return value
}

/**
 * Log-uniform over [1/4, 4], which is far enough to leave no recognisable digit
 * and near enough that an account still reads as the size of account it was.
 * Drawn from the system CSPRNG so the draw carries no seed to reproduce it.
 */
function factor(): Decimal {
  const bits = new BigUint64Array(1)
  crypto.getRandomValues(bits)
  const unit = new Exact(bits[0]!.toString()).dividedBy(new Exact(2).pow(64))
  return new Exact(4).pow(unit.times(2).minus(1))
}

interface PerpState {
  marginSummary?: { accountValue?: string; totalNtlPos?: string; totalRawUsd?: string }
  assetPositions?: Array<{ position?: { szi?: string; leverage?: { type?: string } } }>
}
interface SpotState {
  balances?: Array<{ coin?: string; total?: string }>
}

/** The shapes a Hyperliquid account can take, one fixture each. */
function shapeOf(perps: PerpState, spot: SpotState): string {
  const legs = (perps.assetPositions ?? []).map((a) => a.position)
  const sizes = legs.map((p) => Number(p?.szi ?? '0'))
  const longs = sizes.filter((s) => s > 0).length
  const shorts = sizes.filter((s) => s < 0).length
  const spots = (spot.balances ?? []).filter((b) => Number(b.total ?? '0') !== 0).length
  // Ahead of the direction shapes, because the five below are blind to the
  // split this one exists for: an isolated leg posts margin of its own that the
  // cross summaries exclude, and an account holding both is the only shape that
  // shows the two apart. It classified as `perp-long` and the fixture was never
  // captured, which is why `hyperliquid.ts` declares the split unread.
  if (legs.some((p) => p?.leverage?.type === 'isolated') && legs.some((p) => p?.leverage?.type === 'cross')) {
    return 'perp-isolated'
  }
  if (longs && shorts) return 'perp-both-ways'
  if (longs) return 'perp-long'
  if (shorts) return 'perp-short'
  if (spots) return 'spot-only'
  return 'empty'
}

async function write(name: string, body: unknown): Promise<void> {
  const file = `${OUT}${name}.json`
  await Bun.write(file, `${JSON.stringify(body, null, 2)}\n`)
  console.log(`wrote ${file}`)
}

async function rpc<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'tula-capture' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return (await res.json()) as T
}

const call = (id: number, to: string, data: string) => ({
  jsonrpc: '2.0',
  id,
  method: 'eth_call',
  params: [{ to, data }, 'latest'],
})

/**
 * What the chain itself says, so a wrong default cannot pass a test.
 *
 * A default RPC pointed at the wrong chain is silent: token lists are filtered
 * per chain, and `eth_call` to an address holding no code answers `0x` rather
 * than an error, so every balance comes back zero and the chain reads as an
 * empty wallet. The chain id here is the only thing that contradicts that.
 */
async function captureChain(chain: Chain, captured: string): Promise<void> {
  const url = chain.defaultRpcs[0]!

  // Every node the chain may rotate onto, not only the first: a fallback that
  // answers for the wrong chain, or refuses the batch every read here goes out
  // as, is a defect nobody meets until the first one is rate-limited.
  const nodes = await Promise.all(
    chain.defaultRpcs.map(async (node) => {
      // Asked at the size tula would actually send it. A node that answers one
      // call and rejects an array — some public endpoints do — is one no read
      // here works against, and so is one that quietly caps the batch lower, so
      // what came back is captured rather than assumed.
      const identity = await rpc<unknown>(
        node,
        Array.from({ length: BATCH_SIZE }, (_, i) => ({
          jsonrpc: '2.0',
          id: i + 1,
          method: 'eth_chainId',
          params: [],
        })),
      )
      const rows = Array.isArray(identity) ? (identity as Array<{ result?: string }>) : []
      return { rpc: node, chainId: rows[0]?.result, batchAnswered: rows.length }
    }),
  )

  const listUrl = chain.defaultTokenList
  const listRes = await fetch(listUrl, { headers: { 'User-Agent': 'tula-capture' } })
  if (!listRes.ok) throw new Error(`${listUrl} -> HTTP ${listRes.status}`)
  const list = (await listRes.json()) as { name?: string; tokens?: TokenEntry[] }
  const mine = (list.tokens ?? []).filter((t) => t.chainId === chain.eip155)

  // The reserve list is what proves the Pool address answers on this chain: an
  // address with no code returns nothing, and nothing is not an empty market.
  const markets = DEPLOYMENTS.filter((d) => d.chain === chain.id)
  const reserveLists = markets.length
    ? await rpc<Array<{ id: number; result?: string }>>(
        url,
        markets.map((m, i) => call(i, m.pool, SELECTOR.getReservesList)),
      )
    : []

  const symbolsOf = async (listHex: string): Promise<string[]> => {
    const w = words(listHex)
    const underlyings = w.slice(2, 2 + Number(toBigInt(w[1]))).map(wordToAddress)
    const out = await rpc<Array<{ id: number; result?: string }>>(
      url,
      underlyings.map((u, i) => call(i, u, SELECTOR.symbol)),
    )
    return out
      .sort((a, b) => a.id - b.id)
      .map((r) => decodeString(r.result ?? ''))
      .filter((s) => s !== '')
  }

  await write(`chains/${chain.id}`, {
    captured,
    nodes,
    tokenList: {
      url: listUrl,
      name: list.name,
      tokens: mine.length,
      // Names and decimals only. A bridged stablecoin is the case that has to
      // stay distinguishable from what it is named after, and the symbol is
      // what makes it so — no address is needed to check that.
      stablecoins: mine
        .filter((t) => /^(usd|dai)/i.test(t.symbol))
        .map((t) => ({ symbol: t.symbol, decimals: t.decimals }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    },
    aave: await Promise.all(
      markets.map(async (m, i) => ({
        market: m.market,
        reserves: await symbolsOf(reserveLists.find((r) => r.id === i)?.result ?? ''),
      })),
    ),
  })
}

async function main(): Promise<void> {
  const flag = process.argv.indexOf('--scan')
  const limit = flag === -1 ? 40 : Number(process.argv[flag + 1] ?? 40)

  const vault = await info<{ followers?: Array<{ user?: string }> }>({
    type: 'vaultDetails',
    vaultAddress: HLP_VAULT,
  })
  // `followers` carries the literal `Leader` among the addresses, and asking the
  // venue about a user called Leader is an HTTP error that ends the whole
  // capture. It survived only because the five shapes below were always found
  // before the loop reached it.
  const addresses = (vault.followers ?? [])
    .map((f) => f.user)
    .filter((u): u is string => !!u && isAddress(u))

  // `perp-isolated` is not here: no HLP depositor holds an isolated position —
  // 0 of the 99 addresses this call returns — so it is captured from an address
  // given on the command line instead. `tasks/breadth/10-hyperliquid-depth.md`
  // says where such an address comes from.
  const wanted = new Set(['perp-short', 'perp-long', 'perp-both-ways', 'spot-only', 'empty'])
  const captured = new Date().toISOString()

  for (const address of addresses.slice(0, limit)) {
    if (wanted.size === 0) break
    const [perps, spot] = await Promise.all([
      info<PerpState>({ type: 'clearinghouseState', user: address }),
      info<SpotState>({ type: 'spotClearinghouseState', user: address }),
    ])
    const shape = shapeOf(perps, spot)
    if (!wanted.has(shape)) continue
    wanted.delete(shape)
    // One factor across both responses: the venue's liquidation price is stated
    // in the perp book out of the spot USDC behind it, so two factors would put
    // every position in the fixture at a price the venue never gave.
    const by = factor()
    await write(`hyperliquid/${shape}`, {
      captured,
      endpoint: INFO,
      request: { clearinghouseState: '<address>', spotClearinghouseState: '<address>' },
      perps: scale(redact(perps), by),
      spot: scale(redact(spot), by),
    })
  }

  if (wanted.size > 0) {
    console.log(`no account in the first ${limit} followers was: ${[...wanted].join(', ')}`)
  }

  // Named rather than discovered, because the address source above holds none.
  const extra = process.argv.indexOf('--account')
  const given = extra === -1 ? undefined : process.argv[extra + 1]
  if (given) {
    if (!isAddress(given)) throw new Error(`--account ${given} is not an address`)
    const [perps, spot] = await Promise.all([
      info<PerpState>({ type: 'clearinghouseState', user: given }),
      info<SpotState>({ type: 'spotClearinghouseState', user: given }),
    ])
    const by = factor()
    await write(`hyperliquid/${shapeOf(perps, spot)}`, {
      captured,
      endpoint: INFO,
      request: { clearinghouseState: '<address>', spotClearinghouseState: '<address>' },
      perps: scale(redact(perps), by),
      spot: scale(redact(spot), by),
    })
  }

  // The books this connector does not read, so the declared gap is measured
  // against the venue rather than remembered. Names only: the deployer and fee
  // addresses beside them are somebody's, and nothing here needs them.
  const dexs = await info<Array<{ name?: string; fullName?: string } | null>>({ type: 'perpDexs' })
  await write('hyperliquid/perp-dexs', {
    captured,
    endpoint: INFO,
    request: { type: 'perpDexs' },
    // The leading null is the first-party book, which is the one tula reads.
    builders: dexs.filter((d) => d?.name).map((d) => ({ name: d!.name, fullName: d!.fullName })),
  })

  for (const chain of CHAINS) await captureChain(chain, captured)
}

await main()
