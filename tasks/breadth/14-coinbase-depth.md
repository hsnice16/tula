# 14 · Coinbase depth

**Status**: planned

## Goal

Read the rest of what one Coinbase login holds. [`05`](./05-coinbase-and-circle.md)
shipped the venue and left two declarations behind, and they are not the same
kind of thing: one is a second account under a venue already read, the other is a
second regulated venue behind the same login, and it hides a liquidation.

## Acceptance

- **Which shape the portfolio gap is, measured rather than assumed.** The
  connector takes the portfolio from the key's own permissions because that is
  the only handle it is given, and states one key, one portfolio. Coinbase
  publishes an endpoint that lists an account's portfolios and one that returns a
  named portfolio's breakdown; whether a scoped key gets back more than its own
  from either is one call against an account holding two, and that call decides
  the task. If it does, this is a fan-out inside `fetchPositions`. If it does
  not, it is the shape [`cross-domain/03`](../cross-domain/03-watched-addresses.md)
  already built — several credentials under one venue, each row stamped with the
  account it came from, one venue in `/` and one in `storedVenues` — and what is
  left is the connect flow admitting a second Coinbase key, not new plumbing.
- **Two keys naming one portfolio may not double-count.** The store refuses a
  credential it already holds, which is a comparison of key material and cannot
  see that two different key pairs reach the same portfolio. An address says
  which account it is; a key does not. `verifyScope` already reads the portfolio
  id before anything is stored, so the identity to refuse on is in hand at the
  moment the second key is offered.
- **CFTC-regulated futures land as positions.** Coinbase Financial Markets is a
  separate regulated venue reached through the same login, and a futures book
  there is margined, liquidatable and unseen. `ROADMAP.md`'s rule about the tail
  is what puts it in **4** and not with the aggregator: nothing that can be
  called in is bought in. What lands is contracts converted to asset units, so
  `whatBreaksFirst` ranks the position against the asset it tracks rather than
  against a contract count nothing else on the book is denominated in.
- **Whether the margin figure belongs to the position or to the account decides
  where the work is.** An account-wide threshold read as a per-position health
  factor understates the move to liquidation by the leverage on the rest of the
  book — the mistake `kraken.ts` declares rather than makes. If Coinbase states
  only an account figure, this is `src/core/risk.ts` work, a second account-wide
  threshold under a venue that also holds per-position perps, and not a field on
  a row.
- Each gap closed removes its `doesNotRead` entry and the test in
  `coinbase.test.ts` holding it open, in the same change.

## Notes

**What is unknown, and has to be answered before the futures bullets are
estimable.** They are written against the perp shape because that is the only
Coinbase margin shape there is evidence for in this repo.

- **Whether an Advanced Trade CDP key reaches the futures account at all.** It
  is a separate account under an FCM the user enables separately; a view-scoped
  key may answer for it, may need its own enablement, or may not reach it. The
  path the gap's test watches for is where those endpoints were expected to be,
  which is an assumption and not a reach anybody has confirmed.
- **Whether a futures position carries a liquidation price.** A perp row gets
  one from Coinbase directly. If futures publish a margin level against the
  account instead, the `liquidation` written on the row is the wrong home for it
  and the bullet above is the whole of the work.
- **Where the contract size comes from.** A contract is a fixed fraction of the
  asset, and whether that fraction arrives on the position or has to be read off
  the product decides whether the conversion is arithmetic already in hand or a
  second call. A count multiplied by the wrong size is an exposure wrong by two
  orders of magnitude that reports itself as read, which is worse than the gap.
- **Whether futures cash is already in the accounts list.** If it is, reading the
  futures balance as well counts it twice; if it is not, a book that shows the
  position and not the margin behind it is a distance to liquidation nothing can
  compute. Which of the two it is has to be measured before either is written.
