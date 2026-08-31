# 06 · Wallet token balances

**Status**: done

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
- Token decimals are read on-chain and cached for the process, never assumed
  to be 18.
- Zero balances are dropped rather than rendered as rows.
- aTokens and variable-debt tokens are excluded, so a wallet balance never
  double-counts what the Aave connector already reports as collateral or debt.
- The coverage boundary is stated where the user sees it: how many tokens were
  checked, and that a token outside that set is not evidence of a zero balance.
- Ethereum only; `03-chain-coverage` generalizes this and Aave together.

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

Unencumbered wallet holdings are also the clean input to `0.4.0/04-encumbrance` —
they are the assets that are actually free to move.
