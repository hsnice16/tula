# 11 · Wallet depth

**Status**: planned

## Goal

Widen what a plain address is read for, past the ERC-20s one default feed names.

## Acceptance

- **Liquid staking, restaking and yield-bearing stables** — stETH, wstETH, rETH,
  weETH, ezETH, sDAI, USDe, sUSDe, GHO, crvUSD. These are ordinary ERC-20s that
  the default Token Lists feed omits, so a broader default closes the whole of
  it with no call added, no key, and no address leaving the machine.
  `TULA_TOKEN_LIST` already points the feed; what this task decides is which
  list ships as the default and what it costs in list size per chain.
- **What an LP or vault receipt token is a claim on** is [`01`](./01-aggregator-api.md)'s,
  and the connector's own `plan` says so. Naming the pair behind a pool token
  needs each protocol's pool math, which is the treadmill that task exists to
  take. It is listed here because the two halves of this venue's tail split at
  exactly this line, and a reader looking at the wallet's gaps should not have
  to work out that one of them is somewhere else.
- **NFTs and anything that is not an ERC-20.** There is no enumeration
  primitive: `balanceOf` must be asked per token, so an inventory needs an
  indexer rather than a node. That is a third-party seeing the address, which
  `ROADMAP.md` allows only for what tula cannot get itself — and it is exactly
  that. A floor price is not: it is an estimate of a thing that trades by the
  item, and this product does not publish a figure it cannot stand behind, so
  the acceptance is an inventory that is deliberately unpriced.
- Each gap closed removes its `doesNotRead` entry and the test in
  `wallet.test.ts` holding it open, in the same change.

## Notes

The double-count trap in [`06`](./06-wallet-tokens.md) applies to every token
added here: a receipt token another connector already reports as a position must
be excluded, or the book inflates silently — which is worse than the gap.
