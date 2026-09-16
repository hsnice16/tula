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
import { assetOn, canonical } from './symbols.js'
import { PartialRead, type Connector, type ConnectorCredentials, type KeyScope } from './types.js'
import { typed } from '../core/surface.js'
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
const RECEIPT = /^(a|variableDebt|stableDebt)[A-Z]/

/**
 * The address some lists give the gas token, which holds no contract. The native
 * balance is already read by `eth_getBalance`; asked `balanceOf` here, a node
 * that answers the call with an error rather than `0x` fails the whole chain.
 */
const NATIVE_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/**
 * A legacy contract that answers for another's ledger, keyed `eip155:address`,
 * with the contract it answers for. Monerium kept EURe's v1 address on Gnosis
 * as a legacy frontend over v2 (smart-contracts `docs/migrating_V1_to_V2.md`),
 * so it states v2's supply and every balance, and SmolDapp's list carries both:
 * read together, one EURe balance counted twice. Only this known pair, not a rule
 * of equal balances — two unrelated tokens holding the same airdropped amount
 * would both be real.
 */
export const LEDGER_FRONTENDS: Readonly<Record<string, string>> = {
  '100:0xcb444e90d8198415266c6a2724b7900fb12fc56e': '0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430',
}

/**
 * A uint256 is below 10^78, so past 77 decimals every balance scales to zero;
 * a negative count multiplies it instead.
 */
const MAX_DECIMALS = 77

/**
 * The list is a file on somebody else's server or branch, so an entry is only
 * a shape until checked. One malformed entry is dropped rather than failing the
 * chain over a token nobody may hold. A `:` is refused because it is how tula
 * scopes a name to a chain: `optimism:usdt` would take that bridge's price.
 */
const wellFormed = (t: unknown): t is TokenEntry => {
  const e = t as Partial<Record<keyof TokenEntry, unknown>> | null
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.chainId === 'number' &&
    typeof e.address === 'string' &&
    ADDRESS.test(e.address) &&
    typeof e.symbol === 'string' &&
    e.symbol.trim() !== '' &&
    !e.symbol.includes(':') &&
    Number.isInteger(e.decimals) &&
    (e.decimals as number) >= 0 &&
    (e.decimals as number) <= MAX_DECIMALS
  )
}

/**
 * A Token Lists feed carries every chain it covers in one array, so the chain
 * id is the filter — not a fact about which URL it came from. Filtered to one
 * chain and read against another's node, every call reaches an address holding
 * no code, which answers `0x` rather than an error: a whole chain reported as
 * an empty wallet. `assertChain` is the other half of stopping that.
 */
export function chainTokens(entries: readonly unknown[], chain: Chain): TokenEntry[] {
  return entries.filter(
    (t): t is TokenEntry =>
      wellFormed(t) &&
      t.chainId === chain.eip155 &&
      t.address.toLowerCase() !== NATIVE_SENTINEL &&
      !(`${chain.eip155}:${t.address.toLowerCase()}` in LEDGER_FRONTENDS) &&
      !RECEIPT.test(t.symbol),
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
export function assetName(holding: Holding, chain: Chain = ETHEREUM): string {
  const asset = assetOn(chain, holding.address, holding.symbol)
  if (!holding.contested || !holding.address) return asset
  return `${asset} (${holding.address.slice(0, 10)})`
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
      asset: assetName(h, chain),
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
export function contested(tokens: TokenEntry[], chain: Chain = ETHEREUM): Set<string> {
  const seen = new Map<string, number>()
  for (const token of tokens) {
    const key = assetOn(chain, token.address, token.symbol)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([symbol]) => symbol))
}

/**
 * One fetch per distinct list URL, not per chain: most chains here share one
 * default feed, and asking for it once per chain is that many chances to be
 * rate-limited out of a book that needed one.
 */
async function loadList(url: string): Promise<unknown[]> {
  const res = await request(url, { headers: { 'User-Agent': 'tula' } })
  if (!res.ok) throw new TulaError(`the list at ${host(url)} returned HTTP ${res.status}`)
  const body = (await res.json().catch(() => null)) as { tokens?: unknown } | null
  if (!Array.isArray(body?.tokens)) throw new TulaError(`the list at ${host(url)} is not a token list`)
  return body.tokens
}

function listFailure(chains: Chain[], list: PromiseSettledResult<unknown[]>): string {
  const reason = list.status === 'rejected' && list.reason instanceof Error ? list.reason.message : 'the list did not load'
  const names = chains.map((c) => c.name)
  const on = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  const env = chains.length === 1 ? chains[0]!.tokenListEnv[0] : chains[0]!.tokenListEnv[1]
  return (
    `tula cannot tell which ERC-20s to ask about on ${on}: ${reason}.\n` +
    `  Set ${env} to another Token Lists URL, or retry with ${typed('refresh')}.`
  )
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

  const raw = tokens.map((_, i) => toBigInt(words(balances[i] ?? '')[0]))

  // The list's decimals are somebody else's file; the contract's are the
  // token's. Asked only of what is held, so an empty wallet costs no second
  // round. A contract that does not answer — `decimals()` is optional in
  // ERC-20 — keeps the list's figure, the only one there is. A disagreement is
  // not reported: the figure shown is already the chain's, and nothing about
  // the list is the reader's to fix.
  const held = tokens.flatMap((_, i) => (raw[i]! > 0n ? [i] : []))
  const answers =
    held.length === 0
      ? []
      : await ethCallBatch(
          chain,
          held.map((i) => ({ to: tokens[i]!.address, data: SELECTOR.decimals })),
        )
  const decimals = tokens.map((token) => token.decimals)
  held.forEach((i, at) => {
    const word = words(answers[at] ?? '')[0]
    if (word === undefined) return
    const stated = toBigInt(word)
    if (stated <= BigInt(MAX_DECIMALS)) decimals[i] = Number(stated)
  })

  const ambiguous = contested(tokens, chain)
  const holdings: Holding[] = [
    { symbol: chain.nativeSymbol, amount: scale(native, 18) },
    ...tokens.map((token, i) => ({
      symbol: token.symbol,
      amount: scale(raw[i]!, decimals[i]!),
      address: token.address.toLowerCase(),
      contested: ambiguous.has(assetOn(chain, token.address, token.symbol)),
    })),
  ]

  return toPositions(holdings, asOf, chain)
}

export const walletConnector: Connector = {
  venue: WALLET,

  coverage: {
    reads: [
      `the native gas token — ${[...new Set(CHAINS.map((c) => c.nativeSymbol))].join(', ')} — on ${CHAINS.map((c) => c.name).join(', ')}, under one address`,
      'the ERC-20s a Token Lists feed names for each of those chains',
      'a bridge’s token as an asset of its own, named for its chain — arbitrum:USDC.E and polygon:WETH net with neither the issuer’s token nor another bridge’s',
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
        what: `${UNCOVERED_CHAINS}, and every EVM chain not named above`,
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
    // rate-limiting one chain must not take the others off the book, and the
    // reader has to be told which one went or they will go and replace a node
    // that is answering.
    const read = await Promise.allSettled(
      CHAINS.map(async (chain) => {
        const list = lists.get(tokenListUrl(chain))!
        if (list.status === 'rejected') throw list.reason
        return readChain(chain, address, chainTokens(list.value, chain))
      }),
    )

    const positions = read.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    // The chain is already inside each node failure, so nothing is prefixed: a
    // line that opens "The Arbitrum One node…" says which endpoint to fix. A list
    // that did not load fails every chain reading it for one reason, so it is
    // one line naming those chains — nine copies of it buried the rest.
    const failures: (string | Chain[])[] = []
    const unlisted = new Map<string, Chain[]>()
    read.forEach((r, i) => {
      if (r.status === 'fulfilled') return
      const chain = CHAINS[i]!
      const url = tokenListUrl(chain)
      if (lists.get(url)?.status !== 'rejected') {
        failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
        return
      }
      const group = unlisted.get(url)
      if (group) return void group.push(chain)
      unlisted.set(url, [chain])
      failures.push(unlisted.get(url)!)
    })
    const lines = failures.map((f) => (typeof f === 'string' ? f : listFailure(f, lists.get(tokenListUrl(f[0]!))!)))

    if (lines.length === 0) return positions
    // Nothing was read, so there is no partial book to keep — and an empty book
    // that reported itself complete is the failure this tool exists to close.
    if (read.every((r) => r.status === 'rejected')) throw new TulaError(lines.join(' '))
    throw new PartialRead(positions, lines)
  },
}
