# 08 · Aave V4

**Status**: planned

## Goal

Read Aave V4 the way tula reads v3, so a migrated account is a book rather than
an empty one.

V4 is live on Ethereum and holds real deposits. tula reads v3, says it reads v3,
and declares V4 unread — `src/connectors/aave.ts` names it under `doesNotRead`,
`hides: 'liquidation'`, and `scripts/conformance.live.ts` re-checks against the
live address book that V4 Ethereum is still there and still unread. That
declaration is the honest thing to do about a gap; it is not a reason for the gap
to stay. As v3 drains into v4, an Aave position tula cannot see is a liquidation
tula cannot rank.

It sits in this milestone rather than in [10](../venue-reach) by the rule
`ROADMAP.md` already states about the tail: everything uncovered that *can* be
liquidated is hand-built, and the aggregator takes what cannot. V4 hides
`liquidation`.

## Acceptance

- Supplied balances and variable debt across the V4 Hubs on Ethereum, under the
  same address a v3 read takes.
- A health factor per whatever V4 secures a debt with, carried on the position
  the way v3's is — or, where V4 publishes none per position, the split stated
  in `LiquidationParams` rather than approximated.
- The per-reserve liquidation threshold each Hub states, read off the reserve.
  `collateralMoveUnder` weights a shock by it, and a market where one leg omits
  it falls back to value alone.
- A v3 and a V4 position under one address are one venue and two markets, the
  way `aave-prime` and `aave-core` already are — never two venues in the count
  every surface reads off `storedVenues`.
- The declared gap goes only as far as what is read: whatever of V4 stays unread
  keeps its `doesNotRead` entry, with the cost it hides.
- `scripts/conformance.live.ts` re-checks the belief this connector then holds
  about V4, as it does the rest.

## Notes

**What is unknown, and has to be answered before any of the above is estimable.**
The acceptance is written against v3's shape because that is the only shape
there is evidence for.

- **The account model.** V4 is Hubs and Spokes rather than Pools. Which of the
  two an address's position hangs off, and whether one address can hold
  positions in several Spokes of one Hub, decides whether a V4 read is one call
  or one per Spoke.
- **Whether a health factor is per Hub.** v3 states one per market and
  `collateralMoveUnder` groups by market for exactly that reason. If V4 secures
  a debt per Spoke, the grouping in `src/core/risk.ts` is the change, not the
  connector.
- **Whether `getUserAccountData` has an equivalent.** It is the one call v3's
  health factor, threshold and LTV come from. Without it, each figure has to be
  found somewhere else or declared unread — and a health factor tula computes
  itself rather than reads is a number the venue never stated.

The venue handle in [10](../venue-reach/01-venue-handle.md) is written against
V4's base64 `chain::address::id` tuples, which is the one criterion there that
needs a venue tula is already reading — so that bullet lands here, and the field
itself does not wait for this task.

Do not touch the `NOT READ` declaration ahead of the connector. The gap is real
until V4 is read, and the declaration is what tells the user so.
