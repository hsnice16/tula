import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import { host } from '../core/http.js'
import type { Position, Venue } from '../core/position.js'
import {
  addressProblem,
  decodeString,
  encodeAddress,
  ethCall,
  ethCallBatch,
  ethRpcUrl,
  RPC_REMEDY,
  SELECTOR,
  toBigInt,
  wordToAddress,
  words,
} from './evm.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'

export const AAVE: Venue = { id: 'aave', kind: 'lending', name: 'Aave v3 (Ethereum)' }

interface Instance {
  /**
   * The label these rows carry. Core keeps the bare venue id: it is the market
   * almost every account is in, and `aave` is what the user connected.
   */
  venue: string
  name: string
  pool: string
}

/**
 * Aave v3 on Ethereum is four separate markets, not one. A single Pool answers
 * only for itself, so reading Core alone reported an empty book to anyone
 * supplying to Prime or EtherFi — with no `INCOMPLETE`, because nothing had
 * failed. Each address was checked on-chain against `getMarketId()` on its own
 * PoolAddressesProvider.
 */
const INSTANCES: readonly Instance[] = [
  { venue: AAVE.id, name: 'Core', pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' },
  { venue: `${AAVE.id}-prime`, name: 'Prime', pool: '0x4e033931ad43597d96D6bcc25c280717730B58B1' },
  { venue: `${AAVE.id}-etherfi`, name: 'EtherFi', pool: '0x0AA97c284e98396202b6A04024F5E2c65026F3c0' },
  { venue: `${AAVE.id}-horizon`, name: 'Horizon', pool: '0xAe05Cd22df81871bc7cC2a04BeCfb516bFe332C8' },
]

/** Aave prices its aggregate figures in USD with 8 decimals; health factor has 18. */
const BASE_DECIMALS = 8
const WAD = 18

/** `getUserAccountData` returns six: totals, borrowable, threshold, ltv, health. */
const ACCOUNT_WORDS = 6

/** No debt yields max-uint rather than infinity, and that is not a health factor. */
const NO_DEBT = (1n << 256n) - 1n

/**
 * WETH is redeemable for ETH one-for-one and trustlessly, so it is the same
 * exposure and must net with it. wstETH and weETH are not one-for-one and are
 * deliberately left alone; WBTC carries custodian risk and is priced separately.
 */
const CANONICAL: Readonly<Record<string, string>> = { WETH: 'ETH' }

interface Reserve {
  underlying: string
  aToken: string
  variableDebtToken: string
  symbol: string
  decimals: number
}

/**
 * Reserve metadata does not change between refreshes; the balances do. Keyed by
 * pool: the reserves of one market are not the reserves of another, and a
 * single cache served the first market's list to all four.
 */
const reserveCache = new Map<string, Reserve[]>()

async function loadReserves(rpc: string, pool: string): Promise<Reserve[]> {
  const cached = reserveCache.get(pool)
  if (cached) return cached

  const list = words(await ethCall(rpc, { to: pool, data: SELECTOR.getReservesList }))
  const count = Number(toBigInt(list[1]))
  const underlyings = list.slice(2, 2 + count).map((w) => wordToAddress(w))
  if (underlyings.length === 0) {
    throw new TulaError(
      'Aave returned no reserves, which should never happen against a working node.' + RPC_REMEDY,
    )
  }

  const reserveData = await ethCallBatch(
    rpc,
    underlyings.map((asset) => ({ to: pool, data: encodeAddress(SELECTOR.getReserveData, asset) })),
  )

  const tokens = underlyings.map((underlying, i) => {
    const w = words(reserveData[i] ?? '')
    // Verified against mainnet: [8] aToken, [9] stableDebt, [10] variableDebt.
    return { underlying, aToken: wordToAddress(w[8]), variableDebtToken: wordToAddress(w[10]) }
  })

  const meta = await ethCallBatch(rpc, [
    ...underlyings.map((a) => ({ to: a, data: SELECTOR.symbol })),
    ...underlyings.map((a) => ({ to: a, data: SELECTOR.decimals })),
  ])

  // A null is a call that failed, not an answer. Defaulted, the two of them
  // produce a reserve named UNKNOWN — which nets with every other UNKNOWN as
  // if they were one asset — scaled by 18 decimals, which reads a 6-decimal
  // USDC balance as zero. Both are wrong numbers that report themselves as
  // right, so the reserve list is refused instead and the venue is named failed.
  const decoded = tokens.map((t, i) => ({
    ...t,
    symbol: decodeString(meta[i] ?? ''),
    decimals: Number(toBigInt(words(meta[underlyings.length + i] ?? '')[0])),
  }))

  // An empty symbol and a zero decimals count as failures too, not only a null:
  // one nets every such reserve together as a single unnamed asset, the other
  // renders a raw wei integer as a quantity.
  const undecoded = decoded.filter((t) => !t.symbol || !Number.isFinite(t.decimals) || t.decimals <= 0)
  if (undecoded.length > 0) {
    throw new TulaError(
      `The Ethereum node at ${host(rpc)} did not return usable metadata for ` +
        `${undecoded.length} Aave reserve(s).` +
        RPC_REMEDY,
    )
  }

  reserveCache.set(pool, decoded)
  return decoded
}

const scale = (raw: bigint, decimals: number): Decimal =>
  new Decimal(raw.toString()).div(new Decimal(10).pow(decimals))

export const aaveConnector: Connector = {
  venue: AAVE,

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

  /** Provably read-only: a public address, and an `eth_call` cannot write. */
  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const address = creds['address'] ?? ''
    const problem = addressProblem(address)
    if (problem) throw new TulaError(problem)
    await ethCall(ethRpcUrl(), {
      to: INSTANCES[0]!.pool,
      data: encodeAddress(SELECTOR.getUserAccountData, address),
    })
    return { canRead: true, canTrade: false, canWithdraw: false }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const address = creds['address']
    if (!address) throw new TulaError('Aave needs a public address.')
    const rpc = ethRpcUrl()

    // Every market in one batch: four calls to one node cost a round trip, and
    // most accounts are in exactly one of them, so the reserve lists below are
    // loaded only for the markets that answered with something.
    const accounts = await ethCallBatch(
      rpc,
      INSTANCES.map((i) => ({
        to: i.pool,
        data: encodeAddress(SELECTOR.getUserAccountData, address),
      })),
    )
    const asOf = new Date()

    // A market that did not answer is not a market holding nothing. Dropping it
    // silently would be this read's own defect one level down: a book short by
    // whatever that market holds, with nothing saying so.
    const silent = INSTANCES.filter((_, i) => accounts[i] === null).map((one) => one.name)
    if (silent.length > 0) {
      throw new TulaError(
        `The Ethereum node at ${host(rpc)} did not answer for the Aave ` +
          `${silent.join(', ')} ${silent.length === 1 ? 'market' : 'markets'}.` +
          RPC_REMEDY,
      )
    }

    const positions: Position[] = []

    for (const [index, instance] of INSTANCES.entries()) {
      const account = words(accounts[index] ?? '')
      // A pool that answers short is not an account holding nothing: an address
      // with no code answers `0x`, which reads as zero collateral and zero
      // debt, and a truncated answer reads as a health factor of 0 — every
      // collateral leg in that market rendered as liquidatable now.
      if (account.length < ACCOUNT_WORDS) {
        throw new TulaError(
          `The Ethereum node at ${host(rpc)} gave an unreadable answer for the ` +
            `Aave ${instance.name} market.` +
            RPC_REMEDY,
        )
      }
      const totalCollateral = scale(toBigInt(account[0]), BASE_DECIMALS)
      const totalDebt = scale(toBigInt(account[1]), BASE_DECIMALS)
      if (totalCollateral.isZero() && totalDebt.isZero()) continue

      const rawHealth = toBigInt(account[5])
      const healthFactor = rawHealth === NO_DEBT ? null : scale(rawHealth, WAD)

      const reserves = await loadReserves(rpc, instance.pool)
      const balances = await ethCallBatch(rpc, [
        ...reserves.map((r) => ({ to: r.aToken, data: encodeAddress(SELECTOR.balanceOf, address) })),
        ...reserves.map((r) => ({
          to: r.variableDebtToken,
          data: encodeAddress(SELECTOR.balanceOf, address),
        })),
      ])

      // Same reasoning as the reserve metadata above: a failed balance call is
      // not a zero balance. Dropped silently, a missing *debt* leg makes the book
      // read as richer and safer than it is, while the health factor beside it
      // still renders — the exact shape of a wrong number presented as correct.
      const unread = reserves
        .map((r, i) => (balances[i] === null || balances[reserves.length + i] === null ? r.symbol : null))
        .filter((s): s is string => s !== null)
      if (unread.length > 0) {
        throw new TulaError(
          `The Ethereum node at ${host(rpc)} did not return balances for ` +
            `${unread.length} Aave ${instance.name} reserve(s).` +
            RPC_REMEDY,
        )
      }

      const collateralIds: string[] = []
      const ofInstance: Position[] = []

      reserves.forEach((reserve, i) => {
        const asset = CANONICAL[reserve.symbol] ?? reserve.symbol

        const supplied = toBigInt(words(balances[i] ?? '')[0])
        if (supplied > 0n) {
          const quantity = scale(supplied, reserve.decimals)
          const id = `${instance.venue}:collateral:${asset}`
          collateralIds.push(id)
          ofInstance.push({
            id,
            venue: instance.venue,
            kind: 'collateral',
            asset,
            quantity,
            delta: quantity,
            asOf,
            // The health factor is this market's, so every collateral leg in
            // it carries it: any of them falling is what breaks it.
            ...(healthFactor ? { liquidation: { healthFactor } } : {}),
          })
        }

        const borrowed = toBigInt(words(balances[reserves.length + i] ?? '')[0])
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
  },
}
