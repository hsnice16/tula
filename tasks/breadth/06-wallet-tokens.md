# 06 · Wallet token balances

**Status**: done
**Covered by**: `src/connectors/wallet.test.ts`, `src/connectors/evm.test.ts`, `src/core/coverage.test.ts`

## Goal

Tokens held in a plain wallet, owed to nobody and deposited nowhere. Today an
address contributes to exposure only through Aave or Hyperliquid, so anything
sitting idle in the wallet — often the largest unencumbered holding — is missing
from the one number the product exists to give.

## Acceptance

- A watched address yields `spot` positions under `VenueKind: 'wallet'`, with no
  credential of any kind.
- Native ETH via `eth_getBalance`; ERC-20 balances via batched `balanceOf`
  through `src/connectors/evm.ts`.
- Token decimals come from the list entry beside the address, never assumed to
  be 18. Nothing is read on-chain for them and nothing is cached.
- Zero balances are dropped rather than rendered as rows.
- aTokens and variable-debt tokens are excluded, so a wallet balance never
  double-counts what the Aave connector already reports as collateral or debt.
- The coverage boundary is stated where the user sees it, so a token outside the
  list is never read as a zero balance. `walletConnector.coverage` declares what
  is unasked — the liquid staking and yield-bearing stables the default feed
  omits, what an LP or vault receipt is a claim on, every chain outside the
  three, and anything that is not an ERC-20 — and
  [`open-pieces/01`](../open-pieces/01-scope-disclosure.md) is the line it
  reaches. Each gap is held open by a test in `wallet.test.ts`, so closing one
  fails the build until the declaration goes with it.
- Ethereum, Arbitrum One and Base, one address across all three: `03-chain-coverage`
  generalized this and Aave together, onto `src/connectors/chains.ts`.

## Notes

No RPC call enumerates what ERC-20s an address holds — `balanceOf` must be asked
per token, so the token list is a design decision, not a lookup.

It comes from the Token Lists standard (`tokens.uniswap.org`, overridable with
`TULA_TOKEN_LIST`) rather than from the price provider. Tying it to CoinGecko was
the first plan and it was wrong: once the price source is user-selectable, the
contents of a wallet would change when you switched price feeds. Which tokens
exist and what they are worth are two different questions with two different
maintainers. The long tail still belongs to `01-aggregator-api`; a list kept in
this repo is the treadmill ROADMAP warns about.

The double-count trap is the one that produces a *wrong* number rather than an
incomplete one: aTokens are ordinary ERC-20s sitting in the wallet, and Aave
already reports them as `collateral`. Summing both inflates net worth silently,
which is worse than the gap this task closes.

Unencumbered wallet holdings are also the clean input to
[`risk-engine/04-availability`](../risk-engine/04-availability.md) — they are the
assets that are actually free to move.
