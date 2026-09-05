import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { Position, Venue } from '../core/position.js'
import {
  ADDRESS,
  encodeAddress,
  ethCallBatch,
  ethGetBalance,
  SELECTOR,
  toBigInt,
  words,
} from './evm.js'
import type { Connector, ConnectorCredentials, KeyScope } from './types.js'
import { host, request } from '../core/http.js'

export const WALLET: Venue = { id: 'wallet', kind: 'wallet', name: 'Wallet (Ethereum)' }

const rpcUrl = (): string => process.env['TULA_ETH_RPC'] ?? 'https://ethereum-rpc.publicnode.com'

/**
 * The Token Lists standard, maintained by someone whose job it is. Which ERC-20s
 * are worth checking changes weekly; a list kept in this repo is the treadmill
 * ROADMAP warns about. Deliberately independent of the price source, so changing
 * price provider never changes what a wallet is found to hold.
 */
const TOKEN_LIST = process.env['TULA_TOKEN_LIST'] ?? 'https://tokens.uniswap.org'
const MAINNET = 1

export interface TokenEntry {
  chainId: number
  address: string
  symbol: string
  decimals: number
}

/**
 * Receipt tokens are ordinary ERC-20s sitting in the wallet, and the protocol
 * connectors already report what they stand for. Counting both inflates net
 * worth silently, which is worse than the gap this connector closes.
 */
const RECEIPT = /^(a|variableDebt|stableDebt)(Eth|Arb|Bas)?[A-Z]/

export function mainnetTokens(entries: TokenEntry[]): TokenEntry[] {
  return entries.filter(
    (t) => t.chainId === MAINNET && ADDRESS.test(t.address) && !RECEIPT.test(t.symbol),
  )
}

export function scale(raw: bigint, decimals: number): Decimal {
  return new Decimal(raw.toString()).div(new Decimal(10).pow(decimals))
}

/** Zero balances are not holdings; rendering them buries the rows that matter. */
export function toPositions(
  holdings: Array<{ symbol: string; amount: Decimal }>,
  asOf: Date,
): Position[] {
  return holdings
    .filter((h) => !h.amount.isZero())
    .map((h) => ({
      id: `${WALLET.id}:${h.symbol}`,
      venue: WALLET.id,
      kind: 'spot' as const,
      asset: h.symbol.toUpperCase(),
      quantity: h.amount,
      delta: h.amount,
      asOf,
    }))
}

async function loadTokens(): Promise<TokenEntry[]> {
  const res = await request(TOKEN_LIST, { headers: { 'User-Agent': 'tula' } })
  if (!res.ok) {
    throw new TulaError(
      `The token list at ${host(TOKEN_LIST)} returned HTTP ${res.status}.\n` +
        '  Wallet balances need it to know which ERC-20s to ask about.\n' +
        '  Set TULA_TOKEN_LIST to another Token Lists URL, or retry with /refresh.',
    )
  }
  const body = (await res.json()) as { tokens?: TokenEntry[] }
  return mainnetTokens(body.tokens ?? [])
}

export const walletConnector: Connector = {
  venue: WALLET,

  fields: [
    {
      name: 'address',
      label: 'Public address',
      secret: false,
      hint: '0x… — an address, never a key or a seed phrase. tula can only read it.',
    },
  ],

  help: [
    { label: 'What a token list is', url: 'https://tokenlists.org/' },
    { label: 'Check the address on Etherscan', url: 'https://etherscan.io/' },
  ],

  /** Provably read-only: there is no credential at all, only a public address. */
  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const address = creds['address']
    if (!address || !ADDRESS.test(address)) {
      throw new TulaError('That is not an Ethereum address. It should be 0x followed by 40 hex characters.')
    }
    await ethGetBalance(rpcUrl(), address)
    return { canRead: true, canTrade: false, canWithdraw: false }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const address = creds['address']
    if (!address) throw new TulaError('A wallet needs a public address.')
    const rpc = rpcUrl()

    const tokens = await loadTokens()
    const [native, balances] = await Promise.all([
      ethGetBalance(rpc, address),
      ethCallBatch(
        rpc,
        tokens.map((t) => ({ to: t.address, data: encodeAddress(SELECTOR.balanceOf, address) })),
      ),
    ])
    const asOf = new Date()

    const holdings = [
      { symbol: 'ETH', amount: scale(native, 18) },
      ...tokens.flatMap((token, i) => {
        const raw = balances[i]
        // A null is a call that failed, not a zero balance. Dropping it keeps a
        // flaky RPC from reading as "you do not hold this".
        if (!raw) return []
        return [{ symbol: token.symbol, amount: scale(toBigInt(words(raw)[0]), token.decimals) }]
      }),
    ]

    return toPositions(holdings, asOf)
  },
}
