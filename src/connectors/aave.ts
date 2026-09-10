import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import { host } from '../core/http.js'
import type { Position, Venue } from '../core/position.js'
import {
  CHAINS,
  chainById,
  ETHEREUM,
  rpcRemedy,
  rpcUrl,
  UNCOVERED_CHAINS,
  type Chain,
  type ChainId,
} from './chains.js'
import {
  addressProblem,
  assertChain,
  decodeString,
  encodeAddress,
  encodeUint,
  ethCall,
  ethCallBatch,
  scale,
  SELECTOR,
  toBigInt,
  wordToAddress,
  words,
} from './evm.js'
import { canonical } from './symbols.js'
import { PartialRead, type Connector, type ConnectorCredentials, type KeyScope } from './types.js'

export const AAVE: Venue = {
  id: 'aave',
  kind: 'lending',
  name: `Aave v3 (${CHAINS.map((c) => c.name).join(', ')})`,
}

interface Instance {
  chain: Chain
  /**
   * The label these rows carry. Ethereum Core keeps the bare venue id: it is
   * the market almost every account is in, and `aave` is what the user
   * connected. What distinguishes the rest differs by chain — on Ethereum it is
   * the market, and on the other two there is one market, so it is the chain.
   */
  venue: string
  /** The market's own name. A failure says it with the chain: "Core on Base". */
  name: string
  pool: string
}

const where = (instance: Instance): string => `${instance.name} market on ${instance.chain.name}`

/**
 * Aave v3 on Ethereum is four separate markets, not one, and every chain is a
 * deployment of its own. A single Pool answers only for itself, so reading Core
 * alone reported an empty book to anyone supplying to Prime or EtherFi — with
 * no `INCOMPLETE`, because nothing had failed.
 *
 * Ethereum's four were each checked on-chain against `getMarketId()` on their
 * own PoolAddressesProvider. Arbitrum's and Base's are the `POOL` constants in
 * bgd-labs/aave-address-book, the register Aave's own docs defer to, and both
 * were confirmed to carry code at that address on that chain and nowhere else.
 * Arbitrum's is the address Aave also deploys on Polygon, Avalanche and
 * Optimism, which is why nothing below may key on a Pool alone.
 */
const INSTANCES: readonly Instance[] = [
  { chain: ETHEREUM, venue: AAVE.id, name: 'Core', pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' },
  { chain: ETHEREUM, venue: `${AAVE.id}-prime`, name: 'Prime', pool: '0x4e033931ad43597d96D6bcc25c280717730B58B1' },
  { chain: ETHEREUM, venue: `${AAVE.id}-etherfi`, name: 'EtherFi', pool: '0x0AA97c284e98396202b6A04024F5E2c65026F3c0' },
  { chain: ETHEREUM, venue: `${AAVE.id}-horizon`, name: 'Horizon', pool: '0xAe05Cd22df81871bc7cC2a04BeCfb516bFe332C8' },
  {
    chain: chainById('arbitrum'),
    venue: `${AAVE.id}-arbitrum`,
    name: 'Core',
    pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  },
  {
    chain: chainById('base'),
    venue: `${AAVE.id}-base`,
    name: 'Core',
    pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  },
]

/** Every deployment in the build, so a fixture is captured against what ships. */
export const DEPLOYMENTS: readonly { chain: ChainId; market: string; pool: string }[] =
  INSTANCES.map((i) => ({ chain: i.chain.id, market: i.name, pool: i.pool }))

/** Aave carries a health factor with 18 decimals, as it does every rate. */
const WAD = 18

/** `getUserAccountData` returns six: totals, borrowable, threshold, ltv, health. */
const ACCOUNT_WORDS = 6

/** No debt yields max-uint rather than infinity, and that is not a health factor. */
const NO_DEBT = (1n << 256n) - 1n

export interface Reserve {
  underlying: string
  aToken: string
  variableDebtToken: string
  symbol: string
  decimals: number
  /** Index into the pool's reserve list, and so into the user's config bitmap. */
  id: number
  /**
   * Basis points, from the reserve's own configuration rather than the
   * account-wide average `getUserAccountData` returns. Zero means the reserve
   * cannot secure a borrow at all, whatever the user's collateral bit says.
   */
  liquidationThreshold: Decimal
  ltv: Decimal
}

/**
 * `ReserveConfigurationMap` is one word of bit fields. LTV and the liquidation
 * threshold are what a shock has to be measured against per asset: the average
 * in `getUserAccountData` treats one asset falling as if every asset fell.
 */
/** Aave states every ratio in basis points, reserve and eMode category alike. */
const bps = (n: bigint): Decimal => new Decimal(n.toString()).div(10_000)

export function reserveConfig(word: string | undefined): { ltv: Decimal; liquidationThreshold: Decimal } {
  const bits = toBigInt(word)
  return { ltv: bps(bits & 0xffffn), liquidationThreshold: bps((bits >> 16n) & 0xffffn) }
}

/**
 * Aave v3 packs two bits per reserve: the low one says the user borrows it, the
 * high one that they have it enabled as collateral. Supplying does not
 * guarantee the high bit — it is cleared by `setUserUseReserveAsCollateral`,
 * and never set for a reserve whose threshold is zero.
 */
export const usedAsCollateral = (config: bigint, id: number): boolean =>
  ((config >> BigInt(id * 2 + 1)) & 1n) === 1n

export const isBorrowing = (config: bigint, id: number): boolean =>
  ((config >> BigInt(id * 2)) & 1n) === 1n

/**
 * Reserve metadata does not change between refreshes; the balances do.
 *
 * Keyed by chain, node and pool together. Aave deploys the same Pool address on
 * Polygon, Arbitrum, Avalanche and Optimism, so a key of the pool alone would
 * serve one chain's reserve list to another and then read balances at token
 * addresses belonging to a different chain.
 *
 * Node and pool would now be enough, but only because `assertChain` refuses a
 * node that is not the chain it was configured as — so no two chains can share
 * a URL. The chain is in the key anyway: what makes a cache correct should not
 * be a check in another module, and this is a wrong-number path.
 */
const reserveCache = new Map<string, Reserve[]>()

const cacheKey = (chain: Chain, pool: string): string =>
  `${chain.id}|${rpcUrl(chain)}|${pool.toLowerCase()}`

/**
 * Every market's reserve list on one chain in one pass. Read a market at a time
 * it cost three round trips each, which is what made reading only the markets
 * that looked occupied worth doing — and looking occupied is exactly what an
 * account supplying without the collateral bit does not do.
 */
async function loadReserves(
  chain: Chain,
  instances: readonly Instance[],
): Promise<Map<string, Reserve[]>> {
  const out = new Map<string, Reserve[]>()
  const missing = instances.filter((i) => {
    const cached = reserveCache.get(cacheKey(chain, i.pool))
    if (cached) out.set(i.pool, cached)
    return !cached
  })
  if (missing.length === 0) return out

  const lists = await ethCallBatch(
    chain,
    missing.map((i) => ({ to: i.pool, data: SELECTOR.getReservesList })),
  )

  // Flattened across markets so the batches below are sized by the whole read
  // rather than by whichever market is smallest.
  const wanted: Array<{ pool: string; underlying: string }> = []
  missing.forEach((instance, i) => {
    const list = words(lists[i] ?? '')
    const count = Number(toBigInt(list[1]))
    const underlyings = list.slice(2, 2 + count).map((w) => wordToAddress(w))
    // An address holding no code answers `0x` rather than an error, so a Pool
    // that is not deployed where it was configured reads as a market with no
    // reserves — which is not a market that is empty, it is a market nobody
    // found. `assertChain` catches the commoner cause; this catches a wrong
    // address on a right chain.
    if (underlyings.length === 0) {
      throw new TulaError(
        `Aave returned no reserves for the ${where(instance)}, which should never ` +
          'happen against a working node.' +
          rpcRemedy(chain),
      )
    }
    for (const underlying of underlyings) wanted.push({ pool: instance.pool, underlying })
  })

  const reserveData = await ethCallBatch(
    chain,
    wanted.map((w) => ({ to: w.pool, data: encodeAddress(SELECTOR.getReserveData, w.underlying) })),
  )

  const meta = await ethCallBatch(chain, [
    ...wanted.map((w) => ({ to: w.underlying, data: SELECTOR.symbol })),
    ...wanted.map((w) => ({ to: w.underlying, data: SELECTOR.decimals })),
  ])

  // A null is a call that failed, not an answer. Defaulted, the two of them
  // produce a reserve named UNKNOWN — which nets with every other UNKNOWN as
  // if they were one asset — scaled by 18 decimals, which reads a 6-decimal
  // USDC balance as zero. Both are wrong numbers that report themselves as
  // right, so the reserve list is refused instead and the venue is named failed.
  const decoded = wanted.map((w, i) => {
    // Verified against mainnet: [7] id, [8] aToken, [9] stableDebt, [10] variableDebt.
    const data = words(reserveData[i] ?? '')
    return {
      pool: w.pool,
      underlying: w.underlying,
      aToken: wordToAddress(data[8]),
      variableDebtToken: wordToAddress(data[10]),
      id: Number(toBigInt(data[7])),
      ...reserveConfig(data[0]),
      symbol: decodeString(meta[i] ?? ''),
      decimals: Number(toBigInt(words(meta[wanted.length + i] ?? '')[0])),
    }
  })

  // An empty symbol and a zero decimals count as failures too, not only a null:
  // one nets every such reserve together as a single unnamed asset, the other
  // renders a raw wei integer as a quantity.
  const undecoded = decoded.filter((t) => !t.symbol || !Number.isFinite(t.decimals) || t.decimals <= 0)
  if (undecoded.length > 0) {
    throw new TulaError(
      `The ${chain.name} node at ${host(rpcUrl(chain))} did not return usable metadata for ` +
        `${undecoded.length} Aave reserve(s).` +
        rpcRemedy(chain),
    )
  }

  for (const instance of missing) {
    const mine = decoded.filter((d) => d.pool === instance.pool)
    reserveCache.set(cacheKey(chain, instance.pool), mine)
    out.set(instance.pool, mine)
  }
  return out
}

/**
 * One chain's markets, read as a unit: they share a node, so they fail as one
 * and they are as fresh as one. Every chain is read separately for the opposite
 * reason — a public node rate-limiting Base must leave Ethereum on the book.
 */
/**
 * The thresholds Aave would actually liquidate this account against.
 *
 * An account in an eMode category is liquidated on the *category's* numbers for
 * the assets inside it, not on each reserve's own — 95% against WETH's 83% on
 * Ethereum Core, and one measured account's account-wide LTV was 6827 where the
 * reserve parameters alone give 3740. Read without it, every shock this build
 * weights is measured against a bar the lender would not use.
 *
 * Membership comes from the category's collateral bitmap, indexed by the same
 * reserve id the config bitmap uses. Not from bits [168..175] of the reserve
 * configuration, which is the trap: that field survives on these pools and
 * still mirrors membership for assets onboarded before Liquid eMode, so it
 * looks right on WETH and wstETH — the two anybody would spot-check — while
 * every asset onboarded since reads zero whatever category it is in.
 *
 * Only the categories this account is actually in are fetched. Ids are sparse
 * and run past 48, so enumerating them is both wrong and unbounded.
 */
interface EMode {
  category: number
  threshold: Decimal
  collateral: bigint
}

/** Membership is a bitmask over reserve ids, the same ids the config bitmap uses. */
const inCategory = (eMode: EMode | null, id: number): boolean =>
  eMode !== null && ((eMode.collateral >> BigInt(id)) & 1n) === 1n

async function categoriesOf(
  chain: Chain,
  instances: readonly Instance[],
  summary: ReadonlyArray<string | null>,
): Promise<Array<EMode | null>> {
  const ids = instances.map((_, i) =>
    Number(toBigInt(words(summary[instances.length * 2 + i] ?? '')[0])),
  )
  const inEMode = instances.map((instance, i) => ({ instance, id: ids[i] ?? 0 })).filter((e) => e.id !== 0)
  if (inEMode.length === 0) return instances.map(() => null)

  const answers = await ethCallBatch(chain, [
    ...inEMode.map((e) => ({
      to: e.instance.pool,
      data: encodeUint(SELECTOR.getEModeCategoryCollateralConfig, e.id),
    })),
    ...inEMode.map((e) => ({
      to: e.instance.pool,
      data: encodeUint(SELECTOR.getEModeCategoryCollateralBitmap, e.id),
    })),
  ])

  // A category that will not answer is not a category with no threshold: read
  // as zero it takes every collateral leg inside it off the book, which is the
  // failure this whole read exists to prevent.
  const unread = inEMode.filter((_, i) => answers[i] === null || answers[inEMode.length + i] === null)
  if (unread.length > 0) {
    throw new TulaError(
      `The ${chain.name} node at ${host(rpcUrl(chain))} did not answer for the eMode ` +
        `category of the Aave ${unread.map((e) => e.instance.name).join(', ')} ` +
        `${unread.length === 1 ? 'market' : 'markets'}.` +
        rpcRemedy(chain),
    )
  }

  const found = new Map<Instance, EMode>()
  inEMode.forEach((e, i) => {
    // Static, three words, no offset: ltv, liquidation threshold, bonus.
    const config = words(answers[i] ?? '')
    if (config.length < 3) {
      throw new TulaError(
        `The ${chain.name} node at ${host(rpcUrl(chain))} gave an unreadable eMode category ` +
          `for the Aave ${e.instance.name} market.` +
          rpcRemedy(chain),
      )
    }
    found.set(e.instance, {
      category: e.id,
      threshold: bps(toBigInt(config[1])),
      collateral: toBigInt(words(answers[inEMode.length + i] ?? '')[0]),
    })
  })
  return instances.map((instance) => found.get(instance) ?? null)
}

async function readMarkets(
  chain: Chain,
  instances: readonly Instance[],
  address: string,
): Promise<Position[]> {
  // Rides along with the account read rather than gating it: one extra call to
  // the same node, and a node answering for another chain would report every
  // market here as empty rather than failing.
  await assertChain(chain)

  // The account totals and the collateral bitmap for every market on this
  // chain in one batch: two calls per market cost a single round trip.
  const summary = await ethCallBatch(chain, [
    ...instances.map((i) => ({
      to: i.pool,
      data: encodeAddress(SELECTOR.getUserAccountData, address),
    })),
    ...instances.map((i) => ({
      to: i.pool,
      data: encodeAddress(SELECTOR.getUserConfiguration, address),
    })),
    // Which eMode category the account is in, per market. Nothing else states
    // it, and without it every threshold below is the wrong one.
    ...instances.map((i) => ({
      to: i.pool,
      data: encodeAddress(SELECTOR.getUserEMode, address),
    })),
  ])
  const asOf = new Date()

  // A market that did not answer is not a market holding nothing. Dropping it
  // silently would be this read's own defect one level down: a book short by
  // whatever that market holds, with nothing saying so.
  const silent = instances.filter(
    (_, i) => summary[i] === null || summary[instances.length + i] === null,
  ).map((one) => one.name)
  if (silent.length > 0) {
    throw new TulaError(
      `The ${chain.name} node at ${host(rpcUrl(chain))} did not answer for the Aave ` +
        `${silent.join(', ')} ${silent.length === 1 ? 'market' : 'markets'}.` +
        rpcRemedy(chain),
    )
  }

  for (const [index, instance] of instances.entries()) {
    // A pool that answers short is not an account holding nothing: an address
    // with no code answers `0x`, which reads as zero collateral and zero
    // debt, and a truncated answer reads as a health factor of 0 — every
    // collateral leg in that market rendered as liquidatable now.
    if (words(summary[index] ?? '').length < ACCOUNT_WORDS) {
      throw new TulaError(
        `The ${chain.name} node at ${host(rpcUrl(chain))} gave an unreadable answer for the ` +
          `Aave ${where(instance)}.` +
          rpcRemedy(chain),
      )
    }
  }

  // Every market's balances are read, including the ones reporting no
  // collateral and no debt. `getUserAccountData` counts a reserve toward the
  // totals only when the user's collateral bit is set and the reserve has a
  // threshold, so a supply held for yield, an LTV-0 asset, or collateral
  // simply switched off makes a whole market answer in zeros — and skipping
  // on that answer dropped every token in it without saying anything.
  const byPool = await loadReserves(chain, instances)
  const configs = instances.map((_, i) => toBigInt(words(summary[instances.length + i] ?? '')[0]))
  const eModes = await categoriesOf(chain, instances, summary)
  const legs = instances.flatMap((instance, i) =>
    (byPool.get(instance.pool) ?? []).map((reserve) => ({
      instance,
      reserve,
      // The borrow bit, unlike the collateral one, cannot be off while the
      // balance is on: Aave sets it on the borrow and clears it on the last
      // repayment. So the debt half of the batch — every reserve in every
      // market, ninety-odd calls — is asked only where there is a debt.
      borrowing: isBorrowing(configs[i] ?? 0n, reserve.id),
    })),
  )
  const debts = legs.filter((l) => l.borrowing)
  const balances = await ethCallBatch(chain, [
    ...legs.map((l) => ({
      to: l.reserve.aToken,
      data: encodeAddress(SELECTOR.balanceOf, address),
    })),
    ...debts.map((l) => ({
      to: l.reserve.variableDebtToken,
      data: encodeAddress(SELECTOR.balanceOf, address),
    })),
  ])

  // Same reasoning as the reserve metadata above: a failed balance call is
  // not a zero balance. Dropped silently, a missing *debt* leg makes the book
  // read as richer and safer than it is, while the health factor beside it
  // still renders — the exact shape of a wrong number presented as correct.
  const unread = legs.filter((l, i) => {
    if (balances[i] === null) return true
    const debt = debts.indexOf(l)
    return debt !== -1 && balances[legs.length + debt] === null
  })
  if (unread.length > 0) {
    const markets = [...new Set(unread.map((l) => l.instance.name))]
    throw new TulaError(
      `The ${chain.name} node at ${host(rpcUrl(chain))} did not return balances for ` +
        `${unread.length} Aave ${markets.join(', ')} reserve(s).` +
        rpcRemedy(chain),
    )
  }

  const positions: Position[] = []

  for (const [index, instance] of instances.entries()) {
    const account = words(summary[index] ?? '')
    const userConfig = configs[index] ?? 0n
    const eMode = eModes[index] ?? null
    const rawHealth = toBigInt(account[5])
    const healthFactor = rawHealth === NO_DEBT ? null : scale(rawHealth, WAD)

    const collateralIds: string[] = []
    const ofInstance: Position[] = []

    legs.forEach((leg, at) => {
      if (leg.instance !== instance) return
      const reserve = leg.reserve
      const asset = canonical(reserve.symbol)

      const supplied = toBigInt(words(balances[at] ?? '')[0])
      if (supplied > 0n) {
        // Aave liquidates against the reserves the user has enabled as
        // collateral and no others. Labelling every aToken `collateral` and
        // handing it the market's health factor claimed a liquidation
        // relationship for a balance that secures nothing — and put it in the
        // list a debt says it is covered by.
        // The threshold Aave would actually liquidate this leg against. Inside
        // the account's eMode category that is the category's; outside it the
        // reserve's own, because Liquid eMode still counts out-of-category
        // collateral rather than excluding it — measured against the chain on
        // two accounts, one on Base whose stated account threshold only
        // reproduces with the out-of-category leg counted at its reserve rate.
        const threshold = inCategory(eMode, reserve.id) ? eMode!.threshold : reserve.liquidationThreshold
        // Gated on that rather than on the reserve's own, which is not a
        // refinement: Aave has live reserves at a reserve threshold of 0 that
        // are full collateral inside a category at 92-95%. Read the old way the
        // leg was not weighted wrongly, it stopped being a collateral leg —
        // dropped out of the debt's `encumbers` list and rendered as a plain
        // supply with no liquidation on it at all.
        const secures = usedAsCollateral(userConfig, reserve.id) && threshold.gt(0)
        const quantity = scale(supplied, reserve.decimals)
        const id = `${instance.venue}:${secures ? 'collateral' : 'supply'}:${asset}`
        if (secures) collateralIds.push(id)
        ofInstance.push({
          id,
          venue: instance.venue,
          kind: secures ? 'collateral' : 'spot',
          asset,
          quantity,
          delta: quantity,
          asOf,
          // The health factor is this market's, so every collateral leg in
          // it carries it: any of them falling is what breaks it. The
          // threshold beside it is this reserve's own, which is what says how
          // much of the break each leg is answerable for.
          ...(secures && healthFactor
            ? {
                liquidation: {
                  healthFactor,
                  liquidationThreshold: threshold,
                },
              }
            : {}),
        })
      }

      const debt = debts.indexOf(leg)
      const borrowed = debt === -1 ? 0n : toBigInt(words(balances[legs.length + debt] ?? '')[0])
      if (borrowed > 0n) {
        const quantity = scale(borrowed, reserve.decimals).negated()
        ofInstance.push({
          id: `${instance.venue}:debt:${asset}`,
          venue: instance.venue,
          kind: 'debt',
          asset,
          quantity,
          delta: quantity,
          asOf,
        })
      }
    })

    // A debt is meaningless without the collateral securing it — and each
    // market secures its own. A debt in one pointing at collateral in another
    // would claim a liquidation relationship that does not exist.
    positions.push(
      ...ofInstance.map((p) =>
        p.kind === 'debt' && collateralIds.length > 0 ? { ...p, encumbers: collateralIds } : p,
      ),
    )
  }

  return positions
}

export const aaveConnector: Connector = {
  venue: AAVE,

  coverage: {
    reads: [
      'supplied balances in all four Aave v3 Ethereum markets, collateral-flagged or not',
      'the Aave v3 markets on Arbitrum One and Base, under the same address',
      'variable-rate debt, and the market health factor securing it',
      'the per-reserve liquidation threshold and LTV each market states, and the eMode\n      category\u2019s where the account is in one',
    ],
    doesNotRead: [
      {
        what: 'Aave V4, whose Core, Prime and Plus Hubs on Ethereum hold real deposits',
        why:
          'V4 is Hubs and Spokes rather than Pools, so none of the calls here reach it and a ' +
          'migrated account reads as an empty book',
        hides: 'liquidation',
        plan: 'tasks/breadth/08-aave-v4.md',
      },
      {
        what: 'the Safety Module — staked AAVE, ABPT and GHO',
        why: 'the stake contracts are never called',
        hides: 'value',
        plan: 'tasks/breadth/09-aave-depth.md',
      },
      {
        what: 'stable-rate debt',
        why: 'only the variable debt token is read; the stable one is word [9] and unasked',
        hides: 'liquidation',
        plan: 'tasks/breadth/09-aave-depth.md',
      },
      {
        what: `every chain but ${CHAINS.map((c) => c.name).join(', ')} — ${UNCOVERED_CHAINS} included`,
        why:
          'Aave v3 is deployed on a dozen more chains — Polygon, Optimism, Avalanche, Gnosis, ' +
          'Scroll, Linea and others — and only these three chains are in the build; on HyperEVM ' +
          'there is no Aave at all, and the Aave-shaped lender there is a separate protocol ' +
          'with its own contracts',
        hides: 'liquidation',
        plan: 'tasks/breadth/12-chain-reach.md',
      },
      {
        what: 'isolation mode and the borrow cap that comes with it',
        why: 'the debt ceiling in the reserve configuration is not decoded',
        hides: 'liquidation',
        plan: 'tasks/breadth/09-aave-depth.md',
      },
    ],
  },

  fields: [
    {
      name: 'address',
      label: 'Public address',
      secret: false,
      hint: '0x… — an address, never a key or a seed phrase',
    },
  ],

  help: [
    { label: 'What a health factor is', url: 'https://aave.com/docs/concepts/liquidations' },
    { label: 'Your Aave dashboard', url: 'https://app.aave.com/' },
    { label: 'Aave v3 documentation', url: 'https://aave.com/docs' },
  ],

  /**
   * Provably read-only: a public address, and an `eth_call` cannot write.
   * Checked against Ethereum Core alone — the address is the whole credential
   * on every chain, so a second deployment proves nothing the first did not.
   */
  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const address = creds['address'] ?? ''
    const problem = addressProblem(address)
    if (problem) throw new TulaError(problem)
    await ethCall(ETHEREUM, {
      to: INSTANCES[0]!.pool,
      data: encodeAddress(SELECTOR.getUserAccountData, address),
    })
    return { canRead: true, canTrade: false, canWithdraw: false }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const address = creds['address']
    if (!address) throw new TulaError('Aave needs a public address.')

    // Grouped by chain, in the order chains are declared, so the failures below
    // read down the book the way the book does.
    const byChain = CHAINS.map((chain) => ({
      chain,
      instances: INSTANCES.filter((i) => i.chain.id === chain.id),
    })).filter((g) => g.instances.length > 0)

    const read = await Promise.allSettled(
      byChain.map((g) => readMarkets(g.chain, g.instances, address)),
    )

    const positions = read.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    // Each message already opens with the chain it is about, so nothing is
    // prefixed here: a reader told "the Base node" knows which node to replace.
    const failures = read.flatMap((r) =>
      r.status === 'rejected' ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : [],
    )

    if (failures.length === 0) return positions
    // Nothing read at all is not a book; it is the absence of one, and saying
    // so is the whole of what `INCOMPLETE` and a non-zero exit are for.
    if (failures.length === byChain.length) throw new TulaError(failures.join(' '))
    throw new PartialRead(positions, failures)
  },
}
