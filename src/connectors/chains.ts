import type { ChainId } from '../core/position.js'
/**
 * The chains tula reads, and how to reach each one.
 *
 * One place, because three things have to agree per chain and drifted apart
 * when they were spread over the connectors: the nodes a call may go to, the
 * EIP-155 id a token list is filtered by, and the name a failure prints. A
 * chain named wrong in a failure sends the reader to fix an endpoint that is
 * working, which on a three-chain book is the commonest way to lose an hour.
 */


export interface Chain {
  readonly id: ChainId

  /**
   * EIP-155 id. Not decorative: it is what a Token Lists feed keys by, and the
   * one thing a node can be asked to prove about itself.
   */
  readonly eip155: number

  /** As it appears in a failure — "The Arbitrum One node at …". */
  readonly name: string

  /**
   * What `eth_getBalance` answers in. All three of these settle gas in ETH, so
   * one native balance nets with another — but it is stated per chain rather
   * than assumed, because the day one of them does not, assuming it would file
   * somebody's gas token under ETH.
   */
  readonly nativeSymbol: string

  /**
   * Environment names that override the nodes, in precedence order. Empty means
   * nothing may override, which is how a test pins a node against a shell that
   * already exports one of these.
   */
  readonly rpcEnv: readonly string[]

  /**
   * Tried in order, and the order is deliberate: the first is the one every
   * read starts on, the rest are what a rate limit falls back to.
   */
  readonly defaultRpcs: readonly string[]

  /** Same precedence rule. The last name is shared, so it must come last. */
  readonly tokenListEnv: readonly string[]
  readonly defaultTokenList: string
}

/**
 * A Token Lists feed carrying every chain here, so one fetch answers for all of
 * them and a chain is never read against another chain's tokens. Per-chain
 * overrides exist for anyone who wants a narrower or a wider list.
 */
const UNISWAP_LIST = 'https://tokens.uniswap.org'

/**
 * `TULA_TOKEN_LIST` came from the release that read one chain, so it means "the
 * list", and it still does: it applies to every chain unless that chain has its
 * own. Dropping it would silently ignore a variable already in dotfiles, which
 * is the wrong way for a rename to fail.
 */
const SHARED_LIST_ENV = 'TULA_TOKEN_LIST'

export const CHAINS: readonly Chain[] = [
  {
    id: 'ethereum',
    eip155: 1,
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    // `TULA_ETH_RPC` is the name the one-chain release shipped. It is an alias
    // now rather than a synonym: `TULA_ETHEREUM_RPC` is the one that matches
    // the other chains, and it wins where both are set.
    rpcEnv: ['TULA_ETHEREUM_RPC', 'TULA_ETH_RPC'],
    defaultRpcs: [
      'https://ethereum-rpc.publicnode.com',
      'https://eth.rpc.blxrbdn.com',
      'https://rpc.mevblocker.io',
    ],
    tokenListEnv: ['TULA_ETHEREUM_TOKEN_LIST', SHARED_LIST_ENV],
    defaultTokenList: UNISWAP_LIST,
  },
  {
    id: 'arbitrum',
    eip155: 42161,
    name: 'Arbitrum One',
    nativeSymbol: 'ETH',
    rpcEnv: ['TULA_ARBITRUM_RPC'],
    defaultRpcs: [
      'https://arbitrum-one-rpc.publicnode.com',
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum-one.public.blastapi.io',
    ],
    tokenListEnv: ['TULA_ARBITRUM_TOKEN_LIST', SHARED_LIST_ENV],
    defaultTokenList: UNISWAP_LIST,
  },
  {
    id: 'base',
    eip155: 8453,
    name: 'Base',
    nativeSymbol: 'ETH',
    rpcEnv: ['TULA_BASE_RPC'],
    defaultRpcs: [
      'https://base-rpc.publicnode.com',
      'https://base-mainnet.public.blastapi.io',
      'https://base.rpc.thirdweb.com',
    ],
    tokenListEnv: ['TULA_BASE_TOKEN_LIST', SHARED_LIST_ENV],
    defaultTokenList: UNISWAP_LIST,
  },
]

export const ETHEREUM = CHAINS[0]!

/** Throws rather than falling back: a default here would read one chain as another. */
export function chainById(id: ChainId): Chain {
  const chain = CHAINS.find((c) => c.id === id)
  if (!chain) throw new Error(`no chain is registered for ${id}`)
  return chain
}

/** Read per call, not at import, so a test can point a chain somewhere else. */
const fromEnv = (names: readonly string[]): string | undefined => {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  return undefined
}

/**
 * Every node this chain may be read against, first one first.
 *
 * A variable may name several, comma-separated, and then those are the whole
 * list: somebody who points a chain at their own node has said which nodes they
 * are willing to expose the address to, and quietly appending the public ones
 * when theirs is busy would answer a privacy decision on their behalf.
 */
export function rpcNodes(chain: Chain): readonly string[] {
  const set = fromEnv(chain.rpcEnv)
  if (set === undefined) return chain.defaultRpcs
  const urls = set.split(',').map((u) => u.trim()).filter(Boolean)
  return urls.length > 0 ? urls : chain.defaultRpcs
}

/**
 * Which node of each chain is answering now, for as long as the process runs.
 *
 * Sticky rather than per call: a chain that has moved off a rate-limited node
 * stays moved. Retrying the busy one first on every batch would spend a round
 * trip to be refused again, and — since a batch is chunked — would read half a
 * book from one node and half from another at two different block heights.
 */
const active = new Map<ChainId, number>()

/** Bounded by the list, so a shrinking override cannot index past its end. */
const at = (chain: Chain, nodes: readonly string[]): number =>
  Math.min(active.get(chain.id) ?? 0, nodes.length - 1)

/** The node a message should name: the one being read against right now. */
export const rpcUrl = (chain: Chain): string => {
  const nodes = rpcNodes(chain)
  return nodes[at(chain, nodes)]!
}

/**
 * Moves this chain to its next node, and says whether there was one.
 *
 * `failed` is the node the caller was on, not a formality: three reads of one
 * chain run at once, so two can fail against the same node — and advancing once
 * per failure would step over the node between them, which is the one that
 * might have answered.
 */
export function failOver(chain: Chain, failed: string): boolean {
  const nodes = rpcNodes(chain)
  const index = at(chain, nodes)
  if (nodes[index] !== failed) return true
  if (index + 1 >= nodes.length) return false
  active.set(chain.id, index + 1)
  return true
}

/**
 * Back to each chain's first node. Only tests call it: rotation is per process,
 * and a test that leaves a chain rotated moves the node out from under the next
 * one — the defect being that the second test then passes for the wrong reason.
 */
export const resetRotation = (): void => active.clear()

export const tokenListUrl = (chain: Chain): string =>
  fromEnv(chain.tokenListEnv) ?? chain.defaultTokenList

/**
 * Every RPC failure has the same two ways out, and neither is obvious. The
 * variable named is this chain's: a book reading three nodes that offered one
 * name sent the reader to replace an endpoint that was answering.
 */
export const rpcRemedy = (chain: Chain): string =>
  `\n  Retry with /refresh, or set ${chain.rpcEnv[0] ?? 'the chain’s RPC variable'} to another ${chain.name} node.`

/**
 * What every connector that reads a chain must say it cannot see. Held here so
 * two connectors cannot disagree about which chains exist — a scope-disclosure
 * line assembled from contradictory manifests is worse than none.
 *
 * One string for both, though `ROADMAP.md` files them apart — HyperEVM refused,
 * Solana only unscheduled. That split is about what this project will build;
 * what the reader is owed is that neither chain is in the figures, and it is
 * the same fact either way. Why each is unread belongs in the manifest's `why`,
 * which is where the two already read differently.
 */
export const UNCOVERED_CHAINS = 'Solana, and Hyperliquid’s own EVM chain (HyperEVM)'

export type { ChainId }
