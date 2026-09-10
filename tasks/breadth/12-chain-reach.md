# 12 · Chain reach

**Status**: planned

## Goal

Every chain both chain-reading connectors declare unread, in the order their
cost actually differs — which is not the order they read in.

`src/connectors/chains.ts` is a registry. What that buys is that most of this
list is an entry in it, and only two are anything more.

## Acceptance

- **The rest of the EVM chains Aave v3 is deployed on** — Polygon, Optimism,
  Avalanche, Gnosis, Scroll, Linea. A chain here is a `CHAINS` entry, three
  public nodes verified the way [`03`](./03-chain-coverage.md) requires, and a
  Pool address confirmed to carry code on that chain and nowhere else. Nothing
  else in the read changes: `wallet.ts` and `aave.ts` already loop the registry
  and fail per chain. This is the cheapest coverage in the tree and it hides a
  liquidation, so it goes first.
- **HyperEVM**, read as one holding rather than two. A balance there is a
  HyperCore spot balance and an EVM ERC-20 scaled against each other per token,
  so the acceptance is both legs and the scaling, or nothing: a number from one
  leg alone is not the holding, and publishing it would be the wrong-number
  failure this product is built against. It also needs a token list, and there
  is no first-party one — that, not the RPC, is the piece to solve. It was
  filed under *Deliberately deferred* while the refusal was read as being about
  the chain; the refusal is about half a reading, and reading both halves is not
  refused.
- **Solana.** A different RPC and account model, so it is a second codebase's
  worth of work rather than a registry entry — it needs its own token-account
  enumeration, its own address shape, and its own connector. It carries lenders
  and perp venues that liquidate, which is squarely what this product ranks, and
  by the rule 4 is split on those are hand-built rather than the aggregator's.
- The `UNCOVERED_CHAINS` string and both connectors' `doesNotRead` entries
  shorten with each chain landed, and the tests holding them open go with them.
  `src/site-claims.test.ts` renders the published chain list off the registry,
  so the README and the site follow with no prose edited.

## Notes

Ordered by what a chain hides rather than by how well known it is. The six EVM
chains are a config change that closes a liquidation gap; Solana is a codebase
that closes the same kind of gap; HyperEVM is neither, and is the only one here
whose blocker is a correctness question rather than an amount of work.
