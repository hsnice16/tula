import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { Position, Venue } from '../core/position.js'
import {
  ADDRESS,
  decodeString,
  encodeAddress,
  ethCall,
  ethCallBatch,
  SELECTOR,
  toBigInt,
  wordToAddress,
  words,
} from './evm.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'

export const AAVE: Venue = { id: 'aave', kind: 'lending', name: 'Aave v3 (Ethereum)' }

const POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'
const rpcUrl = (): string => process.env['TULA_ETH_RPC'] ?? 'https://ethereum-rpc.publicnode.com'

/** Aave prices its aggregate figures in USD with 8 decimals; health factor has 18. */
const BASE_DECIMALS = 8
const WAD = 18

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

/** Reserve metadata does not change between refreshes; the balances do. */
let reserveCache: Reserve[] | null = null

async function loadReserves(rpc: string): Promise<Reserve[]> {
  if (reserveCache) return reserveCache

  const list = words(await ethCall(rpc, { to: POOL, data: SELECTOR.getReservesList }))
  const count = Number(toBigInt(list[1]))
  const underlyings = list.slice(2, 2 + count).map((w) => wordToAddress(w))
  if (underlyings.length === 0) throw new TulaError('Aave returned no reserves.')

  const reserveData = await ethCallBatch(
    rpc,
    underlyings.map((asset) => ({ to: POOL, data: encodeAddress(SELECTOR.getReserveData, asset) })),
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

  reserveCache = tokens.map((t, i) => ({
    ...t,
    symbol: decodeString(meta[i] ?? '') || 'UNKNOWN',
    decimals: Number(toBigInt(words(meta[underlyings.length + i] ?? '')[0])) || 18,
  }))
  return reserveCache
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
    const address = creds['address']
    if (!address || !ADDRESS.test(address)) {
      throw new TulaError('That is not an Ethereum address. It should be 0x followed by 40 hex characters.')
    }
    await ethCall(rpcUrl(), {
      to: POOL,
      data: encodeAddress(SELECTOR.getUserAccountData, address),
    })
    return { canRead: true, canTrade: false, canWithdraw: false }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const address = creds['address']
    if (!address) throw new TulaError('Aave needs a public address.')
    const rpc = rpcUrl()

    const account = words(
      await ethCall(rpc, { to: POOL, data: encodeAddress(SELECTOR.getUserAccountData, address) }),
    )
    const asOf = new Date()
    const totalCollateral = scale(toBigInt(account[0]), BASE_DECIMALS)
    const totalDebt = scale(toBigInt(account[1]), BASE_DECIMALS)
    if (totalCollateral.isZero() && totalDebt.isZero()) return []

    const rawHealth = toBigInt(account[5])
    const healthFactor = rawHealth === NO_DEBT ? null : scale(rawHealth, WAD)

    const reserves = await loadReserves(rpc)
    const balances = await ethCallBatch(rpc, [
      ...reserves.map((r) => ({ to: r.aToken, data: encodeAddress(SELECTOR.balanceOf, address) })),
      ...reserves.map((r) => ({
        to: r.variableDebtToken,
        data: encodeAddress(SELECTOR.balanceOf, address),
      })),
    ])

    const positions: Position[] = []
    const collateralIds: string[] = []

    reserves.forEach((reserve, i) => {
      const asset = CANONICAL[reserve.symbol] ?? reserve.symbol

      const supplied = toBigInt(words(balances[i] ?? '')[0])
      if (supplied > 0n) {
        const quantity = scale(supplied, reserve.decimals)
        const id = `aave:collateral:${asset}`
        collateralIds.push(id)
        positions.push({
          id,
          venue: AAVE.id,
          kind: 'collateral',
          asset,
          quantity,
          delta: quantity,
          asOf,
          // The health factor is a property of the whole account, so every
          // collateral leg carries it: any of them falling is what breaks it.
          ...(healthFactor ? { liquidation: { healthFactor } } : {}),
        })
      }

      const borrowed = toBigInt(words(balances[reserves.length + i] ?? '')[0])
      if (borrowed > 0n) {
        const quantity = scale(borrowed, reserve.decimals).negated()
        positions.push({
          id: `aave:debt:${asset}`,
          venue: AAVE.id,
          kind: 'debt',
          asset,
          quantity,
          delta: quantity,
          asOf,
        })
      }
    })

    // A debt is meaningless without the collateral securing it.
    return positions.map((p) =>
      p.kind === 'debt' && collateralIds.length > 0 ? { ...p, encumbers: collateralIds } : p,
    )
  },
}
