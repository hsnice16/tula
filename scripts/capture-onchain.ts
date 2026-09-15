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
 *   bun scripts/capture-onchain.ts               # refresh every fixture
 *   bun scripts/capture-onchain.ts --scan 400    # look at more accounts per source
 *   bun scripts/capture-onchain.ts --hyperliquid # the Hyperliquid fixtures alone
 *   bun scripts/capture-onchain.ts --chains      # the chain fixtures alone
 *   bun scripts/capture-onchain.ts --hyperliquid --only unified-short,perp-long
 *   bun scripts/capture-onchain.ts --hyperliquid --account 0x…  # try this address for its shape before discovery
 *
 * `--scan` takes a whole number of 1 or more, and defaults to 200.
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
import { LEDGER_FRONTENDS, type TokenEntry } from '../src/connectors/wallet.js'

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

/** Weight 2 in Hyperliquid's table; `userRole` is 60 and every other request 20. */
const LIGHT = new Set(['l2Book', 'allMids', 'clearinghouseState', 'orderStatus', 'spotClearinghouseState', 'exchangeStatus'])

/** Weighed again per 20 items they return. Of these only `recentTrades` is asked here. */
const PER_ITEM = new Set(['recentTrades', 'historicalOrders', 'userFills', 'userFillsByTime', 'fundingHistory', 'userFunding'])

/**
 * Paced under Hyperliquid's info budget of 1200 weight a minute per IP
 * (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits).
 * Finding an account in a given mode asks the mode of hundreds of accounts, and
 * an unpaced run is a 429 part way through that leaves half the fixtures new.
 * `conformance.live.ts` samples the same calls, so `send` is the caller's own
 * transport and the pacing is this one.
 */
export async function paced<T>(body: Record<string, unknown>, send: (json: string) => Promise<Response>): Promise<T> {
  const type = String(body['type'])
  const weight = LIGHT.has(type) ? 2 : type === 'userRole' ? 60 : 20
  for (let attempt = 0; ; attempt++) {
    const res = await send(JSON.stringify(body))
    if (res.status === 429 && attempt < 8) {
      await Bun.sleep(15_000)
      continue
    }
    if (!res.ok) throw new Error(`${JSON.stringify(body)} -> HTTP ${res.status}`)
    const answer = (await res.json()) as T
    const items = PER_ITEM.has(type) && Array.isArray(answer) ? Math.floor(answer.length / 20) : 0
    await Bun.sleep((weight + items) * 55)
    return answer
  }
}

const info = <T>(body: Record<string, unknown>): Promise<T> =>
  paced<T>(body, (json) =>
    fetch(INFO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'tula-capture' },
      body: json,
    }),
  )

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
 * The fields carrying an amount. Several do not read like one: `rawUsd` is the
 * margin inside an isolated position's `leverage`; `allTime`, `sinceOpen` and
 * `sinceChange` are funding paid, named for their window not their unit; `sz`
 * and `origSz` are an order's size; `basis` and `value` are the borrow/lend
 * book's principal and its balance with interest; `equity` is a vault share.
 */
const AMOUNT = new Set([
  'borrowed',
  'supplied',
  'spotHold',
  'sz',
  'origSz',
  'delegated',
  'undelegated',
  'totalPendingWithdrawal',
  'equity',
  'basis',
  'value',
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
 * the amounts, so multiplying them is what would break them. The ratios are
 * kept for the same reason, and two of them against a venue constant a factor
 * never touches — `tokenToPortfolioBorrowRatio` is a borrow over a per-user cap —
 * so they disagree with the scaled amounts beside them by that factor, which no
 * test may assert across.
 */
const KEPT = new Set([
  'coin',
  'entryPx',
  'liquidationPx',
  'returnOnEquity',
  'limitPx',
  'triggerPx',
  'ltv',
  'portfolioMarginRatio',
  'tokenToPortfolioBorrowRatio',
  'tokenToPortfolioSupplyRatio',
  'healthFactor',
])

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
  assetPositions?: Array<{ position?: { coin?: string; szi?: string; leverage?: { type?: string } } }>
}
interface SpotState {
  balances?: Array<{ coin?: string; total?: string; borrowed?: string; ltv?: string }>
}

/** One account as the capture reads it: its mode and every book it holds. */
interface Account {
  mode: string
  spot: SpotState
  /** Keyed by dex name; `''` is the first-party book. */
  books: Record<string, PerpState>
}

const legs = (book: PerpState | undefined) => (book?.assetPositions ?? []).flatMap((a) => a.position ?? [])
const allLegs = (a: Account) => Object.values(a.books).flatMap(legs)
const short = (l: { szi?: string }) => Number(l.szi ?? '0') < 0
const holds = (a: Account, coin: string) =>
  (a.spot.balances ?? []).some((b) => b.coin === coin && Number(b.total ?? '0') > 0)

/**
 * The shapes a figure depends on, beyond the five an HLP depositor takes, and
 * where accounts in each were found. HLP depositors are one regime — every one
 * of them carried `tokenToAvailableAfterMaintenance` — so a fixture set drawn
 * from them alone could not see a standard account beside a unified one, and the
 * USDC row was wrong in exactly the mode no fixture was in.
 *
 * Each is filled by a different account, so no two fixtures are one person.
 */
const SHAPES: ReadonlyArray<{
  name: string
  is: (a: Account, collateral: ReadonlyMap<string, string>) => boolean
}> = [
  // The tester's shape. recentTrades users: 41 of 150 sampled were unified, 19
  // of those 41 held a short.
  {
    name: 'unified-short',
    is: (a) => a.mode === 'unifiedAccount' && allLegs(a).some(short) && holds(a, 'USDC'),
  },
  // recentTrades users: 56 of 150 were `disabled`, 37 of them holding spot USDC
  // beside a first-party perp — the two halves a balance fix must not merge.
  {
    name: 'standard-spot-and-perp',
    is: (a) => a.mode === 'disabled' && holds(a, 'USDC') && legs(a.books['']).length > 0,
  },
  // recentTrades users on a USDE, USDH or USDT0 dex's markets: 1 of 150, and
  // that one was in `default` mode — so this is asked first, or the rarest
  // shape loses its only account to the commonest.
  {
    name: 'builder-dex-other-collateral',
    is: (a, collateral) =>
      Object.entries(a.books).some(([dex, book]) => dex !== '' && collateral.get(dex) !== 'USDC' && legs(book).length > 0),
  },
  // recentTrades users: 8 of 150. Undocumented beside `disabled`, so captured
  // on its own rather than assumed to be the same thing.
  { name: 'default-mode', is: (a) => a.mode === 'default' && allLegs(a).length > 0 },
  // recentTrades users on builder-dex markets: 28 standard and 24 unified
  // accounts of 150 held a position on one.
  {
    name: 'builder-dex',
    is: (a, collateral) =>
      Object.entries(a.books).some(([dex, book]) => dex !== '' && collateral.get(dex) === 'USDC' && legs(book).length > 0),
  },
  // 4 of 150 recentTrades users were on portfolio margin and 2 of those had
  // borrowed; the leaderboard is denser — 13 borrowers in the top 600 by
  // account value.
  {
    name: 'portfolio-margin-borrow',
    is: (a) =>
      a.mode === 'portfolioMargin' &&
      (a.spot.balances ?? []).some((b) => Number(b.borrowed ?? '0') > 0) &&
      allLegs(a).some(short),
  },
  {
    name: 'portfolio-margin-collateral',
    is: (a) =>
      a.mode === 'portfolioMargin' &&
      (a.spot.balances ?? []).some(
        (b) => (b.coin === 'HYPE' || b.coin === 'UBTC') && Number(b.ltv ?? '0') > 0 && Number(b.total ?? '0') > 0,
      ),
  },
  // No HLP depositor holds an isolated position — 0 of the 99 the follower list
  // returns — while 13 of the leaderboard's top 200 did, and 22 of 150
  // recentTrades users held both kinds at once.
  {
    name: 'perp-isolated',
    is: (a) => {
      const types = legs(a.books['']).map((l) => l.leverage?.type)
      return types.includes('isolated') && types.includes('cross')
    },
  },
]

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

const TOTAL_SUPPLY = '0x18160ddd'

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

  // Both sides of each frontend pair the wallet skips one of, so that skip is
  // held to the chain's own answer that they are one ledger. Supplies only: a
  // contract's total names nobody.
  const pairs = Object.entries(LEDGER_FRONTENDS).filter(([at]) => at.startsWith(`${chain.eip155}:`))
  const supplies = pairs.length
    ? await rpc<Array<{ id: number; result?: string }>>(
        url,
        pairs.flatMap(([at, current], i) => [
          call(2 * i, at.split(':')[1]!, TOTAL_SUPPLY),
          call(2 * i + 1, current, TOTAL_SUPPLY),
        ]),
      )
    : []
  const supplyOf = (id: number): string => toBigInt(words(supplies.find((r) => r.id === id)?.result ?? '')[0]).toString()

  await write(`chains/${chain.id}`, {
    captured,
    nodes,
    sharedLedgers: pairs.map((_, i) => ({ frontendSupply: supplyOf(2 * i), currentSupply: supplyOf(2 * i + 1) })),
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

interface PerpMeta {
  collateralToken?: number
  universe?: Array<{ name: string; isDelisted?: boolean } & Record<string, unknown>>
  marginTables?: unknown
}
interface SpotMeta {
  tokens?: Array<{ index: number; name: string }>
  universe?: Array<{ name: string; tokens: [number, number] }>
}

/** What an order says about a hold. Its id, client id and time are a lookup key into the public block record, and nothing here reads them. */
const ORDER_FIELDS = [
  'coin',
  'side',
  'limitPx',
  'sz',
  'origSz',
  'reduceOnly',
  'orderType',
  'tif',
  'isTrigger',
  'triggerPx',
  'triggerCondition',
  'isPositionTpsl',
]

async function captureHyperliquid(captured: string): Promise<void> {
  const flag = process.argv.indexOf('--scan')
  const scan = flag === -1 ? '200' : (process.argv[flag + 1] ?? '')
  const limit = Number(scan)
  // `slice(0, NaN)` is empty, so a mistyped count captured nothing and said so
  // only as every shape going unfound.
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--scan "${scan}" is not a number of accounts; give a whole number of 1 or more`)
  }
  // A subset, so one missing shape can be looked for again without redrawing
  // every other fixture's factor.
  const onlyAt = process.argv.indexOf('--only')
  const only = onlyAt === -1 ? null : new Set((process.argv[onlyAt + 1] ?? '').split(','))
  const wanted = (name: string) => only === null || only.has(name)

  const dexes = await info<Array<{ name?: string; fullName?: string } | null>>({ type: 'perpDexs' })
  // The leading null is the first-party book; `allPerpMetas` is in the same order.
  const names = dexes.map((d) => d?.name ?? '')
  const metas = await info<PerpMeta[]>({ type: 'allPerpMetas' })
  const spotMeta = await info<SpotMeta>({ type: 'spotMeta' })
  const tokenName = new Map((spotMeta.tokens ?? []).map((t) => [t.index, t.name]))
  const collateral = new Map(names.map((n, i) => [n, tokenName.get(metas[i]?.collateralToken ?? -1) ?? '?']))

  const read = async (user: string): Promise<Account> => {
    const mode = await info<string>({ type: 'userAbstraction', user })
    const spot = await info<SpotState>({ type: 'spotClearinghouseState', user })
    const books: Record<string, PerpState> = {}
    for (const dex of names) {
      books[dex] = await info<PerpState>(dex ? { type: 'clearinghouseState', user, dex } : { type: 'clearinghouseState', user })
    }
    return { mode, spot, books }
  }

  const save = async (name: string, found: string, user: string, account: Account): Promise<void> => {
    const orders = await info<Array<Record<string, unknown>>>({ type: 'frontendOpenOrders', user })
    const delegatorSummary = await info<unknown>({ type: 'delegatorSummary', user })
    const userVaultEquities = await info<unknown>({ type: 'userVaultEquities', user })
    const subAccounts = await info<Array<Record<string, unknown>> | null>({ type: 'subAccounts', user })
    const borrowLendUserState = await info<unknown>({ type: 'borrowLendUserState', user })
    // A sub-account answers its own mode, spot state and dexes. The copies
    // `subAccounts` carries are trimmed — its spot state leaves out the pooled
    // figure that says what mode it is in — so each is asked for, the way the
    // connector does, and scaled with the master.
    const subReads = []
    for (const sub of subAccounts ?? []) {
      const subUser = String(sub['subAccountUser'] ?? '')
      if (!isAddress(subUser)) continue
      const books: Record<string, unknown> = {}
      for (const dex of names.filter(Boolean)) books[dex] = await info<unknown>({ type: 'clearinghouseState', user: subUser, dex })
      subReads.push({
        user: subUser,
        userAbstraction: await info<string>({ type: 'userAbstraction', user: subUser }),
        spot: await info<unknown>({ type: 'spotClearinghouseState', user: subUser }),
        perps: await info<unknown>({ type: 'clearinghouseState', user: subUser }),
        dexes: books,
      })
    }
    // One factor and one set of placeholders across every response: the venue
    // states a liquidation price out of the spot balance behind it and a hold
    // out of the orders and margin beside it, so two factors would leave every
    // relation between them describing an account nobody holds.
    const by = factor()
    const seen = new Map<string, string>()
    const part = (value: unknown) => scale(redact(value, seen), by)
    await write(`hyperliquid/${name}`, {
      captured,
      endpoint: INFO,
      found,
      request: {
        user: '<address>',
        types: [
          'userAbstraction',
          'spotClearinghouseState',
          'clearinghouseState (every dex)',
          'frontendOpenOrders',
          'delegatorSummary',
          'userVaultEquities',
          'subAccounts',
          'borrowLendUserState',
          'userAbstraction and clearinghouseState (every builder dex) per sub-account',
        ],
      },
      userAbstraction: account.mode,
      spot: part(account.spot),
      perps: part(account.books['']),
      dexes: Object.fromEntries(names.filter(Boolean).map((dex) => [dex, part(account.books[dex])])),
      openOrders: part(orders.map((o) => Object.fromEntries(ORDER_FIELDS.filter((f) => f in o).map((f) => [f, o[f]])))),
      delegatorSummary: part(delegatorSummary),
      userVaultEquities: part(userVaultEquities),
      // A sub-account's name is its owner's own words, so it is numbered instead.
      subAccounts:
        subAccounts === null ? null : part(subAccounts.map((s, i) => ({ ...s, name: `sub-${i + 1}` }))),
      subAccountReads: part(subReads),
      borrowLendUserState: part(borrowLendUserState),
    })
  }

  const used = new Set<string>()

  const vault = await info<{ followers?: Array<{ user?: string }> }>({
    type: 'vaultDetails',
    vaultAddress: HLP_VAULT,
  })
  // `followers` carries the literal `Leader` among the addresses, and asking the
  // venue about a user called Leader is an HTTP error that ends the whole
  // capture. It survived only because the five shapes below were always found
  // before the loop reached it.
  const followers = (vault.followers ?? [])
    .map((f) => f.user)
    .filter((u): u is string => !!u && isAddress(u))

  const hlp = new Set(['perp-short', 'perp-long', 'perp-both-ways', 'spot-only', 'empty'].filter(wanted))
  for (const address of followers.slice(0, limit)) {
    if (hlp.size === 0) break
    const account = await read(address)
    const shape = shapeOf(account.books[''] ?? {}, account.spot)
    if (!hlp.has(shape)) continue
    hlp.delete(shape)
    used.add(address)
    await save(shape, 'HLP vault followers', address, account)
  }
  if (hlp.size > 0) console.log(`no account in the first ${limit} followers was: ${[...hlp].join(', ')}`)

  // Named first, so an address given on purpose fills its shape before
  // discovery can.
  const pending = SHAPES.filter((s) => wanted(s.name))
  const fill = async (address: string, found: string): Promise<void> => {
    if (used.has(address) || pending.length === 0) return
    const account = await read(address)
    const at = pending.findIndex((s) => s.is(account, collateral))
    if (at === -1) return
    const [shape] = pending.splice(at, 1)
    used.add(address)
    await save(shape!.name, found, address, account)
  }

  const extra = process.argv.indexOf('--account')
  const given = extra === -1 ? undefined : process.argv[extra + 1]
  if (given) {
    if (!isAddress(given)) throw new Error(`--account ${given} is not an address`)
    await fill(given.toLowerCase(), 'named on the command line')
  }

  // Everyone who traded the majors, the two portfolio-margin collateral tokens
  // against USDC, and the first live market of every builder dex.
  const markets = [
    'BTC',
    'ETH',
    'HYPE',
    ...(spotMeta.universe ?? [])
      .filter((u) => ['HYPE', 'UBTC'].includes(tokenName.get(u.tokens[0]) ?? '') && tokenName.get(u.tokens[1]) === 'USDC')
      .map((u) => u.name),
    ...metas.slice(1).flatMap((m) => m.universe?.find((u) => !u.isDelisted)?.name ?? []),
  ]
  const traders = new Set<string>()
  for (const coin of markets) {
    for (const trade of await info<Array<{ users?: string[] }>>({ type: 'recentTrades', coin })) {
      for (const user of trade.users ?? []) if (isAddress(user)) traders.add(user.toLowerCase())
    }
  }
  for (const address of [...traders].slice(0, limit)) {
    if (pending.length === 0) break
    await fill(address, 'recentTrades users')
  }

  if (pending.length > 0) {
    const res = await fetch('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard', {
      headers: { 'User-Agent': 'tula-capture' },
    })
    if (!res.ok) throw new Error(`leaderboard -> HTTP ${res.status}`)
    const rows = ((await res.json()) as { leaderboardRows?: Array<{ ethAddress?: string; accountValue?: string }> })
      .leaderboardRows ?? []
    const leaders = rows
      .filter((r): r is { ethAddress: string; accountValue?: string } => !!r.ethAddress && isAddress(r.ethAddress))
      .sort((a, b) => Number(b.accountValue ?? 0) - Number(a.accountValue ?? 0))
      .map((r) => r.ethAddress.toLowerCase())
    for (const address of leaders.slice(0, limit * 4)) {
      if (pending.length === 0) break
      await fill(address, 'the leaderboard, by account value')
    }
  }
  if (pending.length > 0) {
    console.log(`no account found for: ${pending.map((s) => s.name).join(', ')} — the fixtures already there stand`)
  }

  // Asked of each candidate on its own: `subAccounts` weighs 20, and no shape
  // above can see it. The first account whose sub-accounts hold anything at all.
  if (wanted('sub-accounts')) {
    const candidates = [...traders].filter((a) => !used.has(a)).slice(0, limit)
    for (const address of candidates) {
      const subs = await info<Array<{ clearinghouseState?: PerpState & { marginSummary?: { accountValue?: string } }; spotState?: SpotState }> | null>({
        type: 'subAccounts',
        user: address,
      })
      const holding = (subs ?? []).some(
        (s) =>
          Number(s.clearinghouseState?.marginSummary?.accountValue ?? '0') !== 0 ||
          (s.spotState?.balances ?? []).some((b) => Number(b.total ?? '0') !== 0),
      )
      if (!holding) continue
      used.add(address)
      // 0 of 150 recentTrades users sampled had a sub-account holding anything.
      await save('sub-accounts', 'recentTrades users, filtered by subAccounts', address, await read(address))
      break
    }
  }

  // Every dex the connector reads and the listing it reads about each. Names and
  // collateral only from `perpDexs`: the deployer and fee addresses beside them
  // are somebody's, and nothing here needs them.
  await write('hyperliquid/perp-dexs', {
    captured,
    endpoint: INFO,
    request: { types: ['perpDexs', 'allPerpMetas', 'spotMeta'] },
    builders: dexes
      .filter((d) => d?.name)
      .map((d) => ({ name: d!.name, fullName: d!.fullName, collateral: collateral.get(d!.name!) })),
    metas: metas.map((m, i) => ({
      dex: names[i],
      collateralToken: m.collateralToken,
      universe: m.universe,
      marginTables: m.marginTables,
    })),
    spotTokens: (spotMeta.tokens ?? []).map((t) => ({ index: t.index, name: t.name })),
    // Which tokens a spot order trades, so a hold can be read against the orders
    // that reserve it.
    spotPairs: (spotMeta.universe ?? []).map((u) => ({ name: u.name, tokens: u.tokens })),
  })
}

async function main(): Promise<void> {
  const captured = new Date().toISOString()
  // Either half alone, so refreshing one set of fixtures leaves the other's
  // figures as they were captured.
  const only = process.argv.find((a) => a === '--hyperliquid' || a === '--chains')
  if (only !== '--chains') await captureHyperliquid(captured)
  if (only !== '--hyperliquid') for (const chain of CHAINS) await captureChain(chain, captured)
}

// Imported by `conformance.live.ts` for `paced`, which must not start a capture.
if (import.meta.main) await main()
