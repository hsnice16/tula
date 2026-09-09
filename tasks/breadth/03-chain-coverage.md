# 03 · Chain coverage

**Status**: planned

## Goal

Ethereum, Arbitrum, Base and Hyperliquid L1 for v1.

## Acceptance

- One address is read across all supported chains without being re-entered.
- Per-chain failures degrade loudly and independently: one chain down leaves the
  others intact, and the book says which one went.
- **The failure names the chain it happened on.** Every RPC error today says
  "the Ethereum node", which on a four-chain book sends the reader to fix the
  wrong endpoint.
- **A chain nothing is configured for is uncovered, not failed.** It produces no
  `INCOMPLETE` — it reaches the line in
  [`open-pieces/01`](../open-pieces/01-scope-disclosure.md), because a venue
  never asked is not a venue that answered badly.
- Every chain failing is `INCOMPLETE` and a non-zero exit, not an empty book.
- **One asset nets across chains; one position keeps its chain.** USDC is USDC
  for exposure — `src/core/exposure.ts` keys by a plain `AssetId` — but the
  position it came from has to know where it lives, or `breaks` cannot say what
  to act on and nothing later can build a transaction against it.
- A bridged asset that is not the thing it is named after is not silently netted
  into it. Where the price source treats them as one, that is the price source's
  claim, and it travels with the number rather than being taken as fact.
- The token list is per chain. `src/connectors/wallet.ts` filters to
  `chainId === MAINNET` against one list URL, so both the filter and the default
  generalize or every chain reads Ethereum's tokens.
- Aave reserve discovery runs per deployment, since the reserves on one chain are
  not the reserves on another.
- Freshness is per chain, and an aggregate inherits the oldest of them. A chain
  whose node is behind must not make the whole book look current.
- Each chain's RPC is overridable, and every one has a public default. A single
  `TULA_ETH_RPC` cannot address four chains.
- Covered in `src/connectors/wallet.test.ts` and `src/connectors/evm.test.ts`.

## Notes

`src/connectors/evm.ts` already takes `rpcUrl` per call, so the primitives are
chain-agnostic. What is bound to Ethereum is configuration and copy: `wallet.ts`
and `aave.ts` each hardcode `TULA_ETH_RPC` with one public default, the RPC errors
say "the Ethereum node", and Aave reserve discovery is per-deployment.

Independent of [`open-pieces/02`](../open-pieces/02-credential-store-set.md): one
address across several chains is one credential.

Solana is deferred: a different RPC and token model, effectively a second codebase.
