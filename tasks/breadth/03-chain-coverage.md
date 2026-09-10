# 03 · Chain coverage

**Status**: done
**Covered by**: `src/connectors/wallet.test.ts`, `src/connectors/evm.test.ts`, `src/connectors/aave.test.ts`, `src/core/exposure.test.ts`, `src/cli/shell.test.ts`, `src/site-claims.test.ts`

## Goal

Ethereum, Arbitrum, Base and Hyperliquid L1 for v1.

Ethereum, Arbitrum and Base are `src/connectors/chains.ts` — one registry, so the
node, the EIP-155 id a token list is filtered by, and the name a failure prints
cannot drift apart per connector. Hyperliquid L1 is its own venue and its own
credential; HyperEVM and Solana are declared unread rather than built.

## Acceptance

- One address is read across all supported chains without being re-entered.
- **Per-chain failures are independent.** `wallet.ts` and `aave.ts` read each
  chain under `Promise.allSettled` and raise `PartialRead`
  (`src/connectors/types.ts`) carrying both the rows that came back and the
  failures; `src/cli/session.ts` keeps those rows and pushes one failure line per
  chain, so a rate-limited node costs its own chain and no other. Covered at the
  connector boundary (`wallet.test.ts` › `one node down leaves the other chains
  readable`) and now at the session, where the rows are actually kept or lost
  (`shell.test.ts` › `one chain failing leaves the other chains' rows on the
  book`).
- **The failure names the chain it happened on.** Every RPC error used to say
  "the Ethereum node", which on a multi-chain book sends the reader to fix the
  wrong endpoint. Each message is built from `chain.name` and names that chain's
  own variable, and no two chains offer the same one.
- **A chain nothing is configured for is uncovered, not failed**, and it says so
  on the view rather than being absent from it. `UNCOVERED_CHAINS` and each
  chain-reading connector's `Coverage` block are what
  [`open-pieces/01`](../open-pieces/01-scope-disclosure.md) assembles the
  `NOT READ` line from. Nothing here can reach the failure state instead: every
  chain in `CHAINS` ships a public default RPC.
- Every chain failing is `INCOMPLETE` and a non-zero exit, not an empty book.
  Every chain failing raises a plain `TulaError` rather than a `PartialRead`,
  precisely so the two states cannot be confused.
- **One asset nets across chains; one position keeps its chain.** USDC is USDC
  for exposure — `src/core/exposure.ts` keys by a plain `AssetId` — but the
  position it came from has to know where it lives, or `breaks` cannot say what
  to act on and nothing later can build a transaction against it.
- A bridged asset that is not the thing it is named after is not silently netted
  into it. Where the price source treats them as one, that is the price source's
  claim, and it travels with the number rather than being taken as fact.
- The token list is per chain. `chainTokens()` in `src/connectors/wallet.ts`
  filters the feed by that chain's EIP-155 id, so a chain never reads another
  chain's tokens; one fetch per distinct URL answers for all three.
- Aave reserve discovery runs per deployment, since the reserves on one chain are
  not the reserves on another. The cache is keyed by chain, node and Pool
  together: one Pool address repeats across chains, so pool alone would serve one
  chain's reserve list to another.
- Freshness is per chain, and an aggregate inherits the oldest of them. A chain
  whose node is behind must not make the whole book look current.
- Each chain's RPC is overridable and every one has a public default. A single
  `TULA_ETH_RPC` cannot address three chains, so it is kept as Ethereum's alias
  and the per-chain name wins where both are set.
- **A rate-limited node costs a retry, not the chain.** Each chain ships three
  public nodes and moves to the next on a transport failure, the identity call
  included — that call runs first, so without it a 429 still took the chain.
  Rotation is sticky for the run: retrying the busy node per batch would read
  one book at two block heights. An override replaces the list rather than being
  appended to; a node reached by rotation is chain-checked before anything is
  read off it; and an answer tula distrusts is never re-asked elsewhere.
  `fixtures/chains/*.json` captures every node, not only the first — a fallback
  that answers for the wrong chain, or refuses the batch size every read here
  goes out as, is a defect nobody meets until the first node is rate-limited.
- Covered in `src/connectors/wallet.test.ts` and `src/connectors/evm.test.ts`.

## Notes

`src/connectors/evm.ts` always took `rpcUrl` per call, so the primitives were
chain-agnostic from the start. What was bound to Ethereum was configuration and
copy — one `ethRpcUrl()` reading one variable, and RPC errors that said "the
Ethereum node" whichever node had failed. Both now come from
`src/connectors/chains.ts`, which is also what `src/site-claims.test.ts` renders
the published chain list from.

Independent of [`open-pieces/02`](../open-pieces/02-credential-store-set.md): one
address across several chains is one credential.

Solana is deferred: a different RPC and token model, effectively a second codebase.
