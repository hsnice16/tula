import Decimal from 'decimal.js'
import { TulaError } from '../core/errors.js'
import type { Position, Venue } from '../core/position.js'
import {
  CHAINS,
  ETHEREUM,
  rpcRemedy,
  tokenListUrl,
  UNCOVERED_CHAINS,
  type Chain,
} from './chains.js'
import {
  ADDRESS,
  addressProblem,
  assertChain,
  encodeAddress,
  ethCallBatch,
  ethGetBalance,
  scale,
  SELECTOR,
  toBigInt,
  words,
} from './evm.js'
import { canonical } from './symbols.js'
import { PartialRead, type Connector, type ConnectorCredentials, type KeyScope } from './types.js'
import { host, request } from '../core/http.js'

export const WALLET: Venue = {
  id: 'wallet',
  kind: 'wallet',
  name: `Wallet (${CHAINS.map((c) => c.name).join(', ')})`,
}

/**
 * Ethereum keeps the bare venue id — it is the chain almost every address is
 * used on, and `wallet` is what the user connected. The others carry their own
 * label for the reason the Aave markets do: netting is by asset, so one USDC
 * balance is one exposure wherever it sits, but the row it came from has to say
 * where to act on it.
 */
const venueOf = (chain: Chain): string =>
  chain.id === ETHEREUM.id ? WALLET.id : `${WALLET.id}-${chain.id}`

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

/**
 * A Token Lists feed carries every chain it covers in one array, so the chain
 * id is the filter — not a fact about which URL it came from. Filtered to one
 * chain and read against another's node, every call reaches an address holding
 * no code, which answers `0x` rather than an error: a whole chain reported as
 * an empty wallet. `assertChain` is the other half of stopping that.
 */
export function chainTokens(entries: TokenEntry[], chain: Chain): TokenEntry[] {
  return entries.filter(
    (t) => t.chainId === chain.eip155 && ADDRESS.test(t.address) && !RECEIPT.test(t.symbol),
  )
}

export interface Holding {
  symbol: string
  amount: Decimal
  /** Absent for native ETH, which is the one holding with no contract behind it. */
  address?: string
  /** True when another token on the list answers to the same symbol. */
  contested?: boolean
}

/**
 * A symbol is not an identity. The live Uniswap list carries two distinct
 * mainnet tokens called `LIT` — Litentry and Lighter — and under one id they
 * were added together and priced once, as though a holding of each were a
 * double holding of whichever the price source meant.
 *
 * So the id is the contract, and a contested symbol is qualified by the head of
 * its address in the asset name too: netting is by asset, and two different
 * tokens sharing an asset net into a figure that is nobody's balance. Qualified,
 * neither will match a price and both are reported without one, which is the
 * admitted gap the standing rule asks for over a confident wrong answer.
 */
export function assetName(holding: Holding): string {
  const symbol = canonical(holding.symbol)
  if (!holding.contested || !holding.address) return symbol
  return `${symbol} (${holding.address.slice(0, 10)})`
}

/** Zero balances are not holdings; rendering them buries the rows that matter. */
export function toPositions(holdings: Holding[], asOf: Date, chain: Chain = ETHEREUM): Position[] {
  const venue = venueOf(chain)
  return holdings
    .filter((h) => !h.amount.isZero())
    .map((h) => ({
      id: `${venue}:${h.address ?? canonical(h.symbol)}`,
      venue,
      kind: 'spot' as const,
      asset: assetName(h),
      quantity: h.amount,
      delta: h.amount,
      asOf,
    }))
}

/**
 * Symbols more than one token on the list answers to.
 *
 * Counted within one chain, never across them: USDC on Ethereum and USDC on
 * Base are one asset that has to net, and counted together every stablecoin on
 * the book would be contested and every one of them qualified into a row of its
 * own that nothing prices.
 */
export function contested(tokens: TokenEntry[]): Set<string> {
  const seen = new Map<string, number>()
  for (const token of tokens) {
    const key = canonical(token.symbol)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([symbol]) => symbol))
}

/**
 * One fetch per distinct list URL, not per chain: the default feed carries
 * every chain here in one array, and asking for it three times is three chances
 * to be rate-limited out of a book that needed one.
 */
async function loadList(url: string): Promise<TokenEntry[]> {
  const res = await request(url, { headers: { 'User-Agent': 'tula' } })
  if (!res.ok) throw new TulaError(`the list at ${host(url)} returned HTTP ${res.status}`)
  const body = (await res.json()) as { tokens?: TokenEntry[] }
  return body.tokens ?? []
}

async function readChain(chain: Chain, address: string, tokens: TokenEntry[]): Promise<Position[]> {
  // `assertChain` rides along rather than gating: it is one more call to the
  // same node, and running it first would put a round trip in front of every
  // chain on the book. Promise.all still refuses the whole chain if it fails.
  const [, native, balances] = await Promise.all([
    assertChain(chain),
    ethGetBalance(chain, address),
    ethCallBatch(
      chain,
      tokens.map((t) => ({ to: t.address, data: encodeAddress(SELECTOR.balanceOf, address) })),
    ),
  ])
  // Stamped per chain, so a node that is behind ages only its own rows. Every
  // aggregate already inherits the oldest of its contributors, which is what
  // stops one lagging chain from making the whole book look current.
  const asOf = new Date()

  // A null is a call that failed, not a zero balance — and an absent position
  // says "you do not hold this" with nothing beside it to say otherwise.
  // Dropping it was the quiet version of the answer this whole tool exists to
  // stop giving, so the chain fails instead, exactly as the Aave read does.
  const unread = tokens.filter((_, i) => balances[i] === null)
  if (unread.length > 0) {
    throw new TulaError(
      `The ${chain.name} node did not return balances for ` +
        `${unread.length} of ${tokens.length} tokens.` +
        rpcRemedy(chain),
    )
  }

  const ambiguous = contested(tokens)
  const holdings: Holding[] = [
    { symbol: chain.nativeSymbol, amount: scale(native, 18) },
    ...tokens.map((token, i) => ({
      symbol: token.symbol,
      amount: scale(toBigInt(words(balances[i] ?? '')[0]), token.decimals),
      address: token.address.toLowerCase(),
      contested: ambiguous.has(canonical(token.symbol)),
    })),
  ]

  return toPositions(holdings, asOf, chain)
}

export const walletConnector: Connector = {
  venue: WALLET,

  coverage: {
    reads: [
      `native ETH on ${CHAINS.map((c) => c.name).join(', ')}, under one address`,
      'the ERC-20s a Token Lists feed names for each of those chains',
      'a bridged stablecoin as its own asset — USDC.e, USDbC and USDT0 do not net into USDC or USDT',
    ],
    doesNotRead: [
      {
        what:
          'liquid staking and restaking tokens — stETH, wstETH, rETH, weETH, ezETH — and the ' +
          'yield-bearing stables sDAI, USDe, sUSDe, GHO and crvUSD',
        why: 'none of them are on the default Token Lists feed, and nothing else is asked about',
        hides: 'value',
        plan: 'tasks/breadth/11-wallet-depth.md',
      },
      {
        what: 'what an LP or vault receipt token is a claim on',
        why:
          'only balanceOf is called, so a pool token counts as its own opaque symbol and the ' +
          'pair behind it is never read',
        hides: 'value',
        plan: 'tasks/breadth/01-aggregator-api.md',
      },
      {
        what: `${UNCOVERED_CHAINS}, and every EVM chain outside the three above`,
        why:
          'Solana is a different RPC and token model, a second codebase’s worth of work rather ' +
          'than a chain added here; a HyperEVM balance ' +
          'is two linked balances — a HyperCore spot balance and an EVM ERC-20, scaled against ' +
          'each other per token — so reading either alone states a number that is not the ' +
          'holding, and there is no first-party token list to read it against',
        hides: 'value',
        plan: 'tasks/breadth/12-chain-reach.md',
      },
      {
        what: 'NFTs and anything else that is not an ERC-20',
        why: 'only balanceOf is called',
        hides: 'value',
        plan: 'tasks/breadth/11-wallet-depth.md',
      },
    ],
  },

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

  /**
   * Provably read-only: there is no credential at all, only a public address.
   * Checked against Ethereum alone — the same address is the whole credential
   * on every chain, so a second node proves nothing a first one did not.
   */
  async verifyScope(creds: ConnectorCredentials): Promise<KeyScope> {
    const address = creds['address'] ?? ''
    const problem = addressProblem(address)
    if (problem) throw new TulaError(problem)
    await ethGetBalance(ETHEREUM, address)
    return { canRead: true, canTrade: false, canWithdraw: false }
  },

  async fetchPositions(creds: ConnectorCredentials): Promise<Position[]> {
    const address = creds['address']
    if (!address) throw new TulaError('A wallet needs a public address.')

    const urls = [...new Set(CHAINS.map(tokenListUrl))]
    const lists = new Map(
      (await Promise.allSettled(urls.map(loadList))).map((settled, i) => [urls[i]!, settled]),
    )

    // Every chain read independently, and every failure kept: a public node
    // rate-limiting one chain must not take the other two off the book, and the
    // reader has to be told which one went or they will go and replace a node
    // that is answering.
    const read = await Promise.allSettled(
      CHAINS.map(async (chain) => {
        const list = lists.get(tokenListUrl(chain))!
        if (list.status === 'rejected') {
          throw new TulaError(
            `tula cannot tell which ERC-20s to ask about on ${chain.name}: ` +
              `${list.reason instanceof Error ? list.reason.message : String(list.reason)}.\n` +
              `  Set ${chain.tokenListEnv[0]} to another Token Lists URL, or retry with /refresh.`,
          )
        }
        return readChain(chain, address, chainTokens(list.value, chain))
      }),
    )

    const positions = read.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    // The chain is already inside each message, so nothing is prefixed here: a
    // failure that opens "The Arbitrum One node…" says which endpoint to fix.
    const failures = read.flatMap((r) =>
      r.status === 'rejected'
        ? [r.reason instanceof Error ? r.reason.message : String(r.reason)]
        : [],
    )

    if (failures.length === 0) return positions
    // Nothing was read, so there is no partial book to keep — and an empty book
    // that reported itself complete is the failure this tool exists to close.
    if (failures.length === CHAINS.length) throw new TulaError(failures.join(' '))
    throw new PartialRead(positions, failures)
  },
}
