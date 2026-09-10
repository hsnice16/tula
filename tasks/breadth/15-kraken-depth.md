# 15 · Kraken depth

**Status**: planned

## Goal

Read the rest of a Kraken account. Five declared gaps, and no two of them are the
same kind of work: one call nobody makes, one product on another host behind its
own keys, two holds the endpoint in hand cannot state, and two fields the
connector already receives and drops.

Two hide a liquidation, which is what puts this in **4** rather than with the
aggregator: nothing that can be called in is bought in.

## Acceptance

- **The account margin level**, ranked. `TradeBalance` returns it and
  `kraken.test.ts` holds open that nothing reaches it, but fetching is the small
  half. Kraken liquidates the account, not the leg, and `LiquidationParams`
  hangs off a position: one figure governing every margin row on the account is
  a shape neither `price` nor `healthFactor` describes. That makes it
  `src/core/risk.ts` work as much as connector work — the same question
  [`10`](./10-hyperliquid-depth.md)'s borrow/lend book asks under one venue and
  [`08`](./08-aave-v4.md) asks per Hub. The acceptance is that the figure reaches
  `whatBreaksFirst` and orders those rows; read and left on the connector it
  changes nothing, because they already sort last as unknown. `README.md` states
  this gap twice, and both go with it.
- **Kraken Futures** is closer to a new connector than to a depth read: another
  host, another key, another scope proof, and none of the endpoints this
  connector signs for. Say which it is before it is scheduled as one bullet. The
  Aave precedent does not carry — `aave-prime` and `aave-arbitrum` are one
  credential, a public address, reaching several deployments in a single read,
  which is what makes them labels under one venue. A futures key is a second
  thing the user connects and revokes on its own, so it is its own id in
  `storedVenues`, and the cost of that is a venue count of two for what the user
  has one login to. `Position.account` is not the way out: it tells apart
  accounts of the same shape, and a futures key answers none of the calls a spot
  key answers.
- **The free/held split once a margin position is open.** `hold_trade` covers
  spot non-margin orders, so `spotRows` withholds the split entirely rather than
  name a figure the margin book has already claimed. What would make it true is
  the account-level encumbrance — the first bullet's endpoint, read a second
  time. Doing this one without that one produces a number that is free in
  Kraken's sense and not free.
- **The free/held split across several wallets** costs more than the wording
  says: a second wallet drops the connector to the endpoint reporting a total,
  so the hold vanishes for every wallet, including the one that could have
  stated it. Closing it needs a per-wallet hold from Kraken. If Kraken publishes
  none, the gap is reworded to say that instead — and a declaration retired that
  way needs the check that proves it, in `scripts/conformance.live.ts`, which is
  the file that reruns.
- **Both availability gaps, or the `FREE` column does not move.**
  `availabilityFacts` in `src/core/coverage.ts` blanks that column off the first
  gap declared `hides: 'availability'`, so closing one of the two leaves the
  other blanking it. [`risk-engine/04`](../risk-engine/04-availability.md)
  recorded both as the price of never reporting a total as free; that is a
  shipped answer rather than a defect, and this is the work that would retire
  it.
- **Drawn credit lines.** `credit` and `credit_used` arrive on the `BalanceEx`
  rows already parsed, so nothing here is unreachable — what is missing is the
  decision. A drawn line is a liability and belongs in the book as debt in the
  currency drawn; the undrawn remainder is capacity rather than a holding, and a
  book carrying it reports money nobody has. Its test asserts the rows rather
  than the traffic, because a field that was ignored leaves no trace in the calls
  made.
- Each gap closed removes its `doesNotRead` entry and the test in
  `kraken.test.ts` holding it open, in the same change.

## Notes

**What is unknown, and decides how much of the above is reachable.**

- **The level Kraken liquidates at.** A margin level is a ratio to a trigger,
  not the Aave convention `moveFromHealthFactor` takes, so a distance needs the
  trigger — and whether one level covers every pair, or it moves with the pair,
  is read off Kraken's published margin terms rather than remembered. A
  threshold that is wrong is a distance stated confidently, which is worse than
  the `unknown` these rows carry.
- **Whether the account figure decomposes per asset.** The trade balance is
  stated in one currency and the free/held split is per asset. If what the
  margin book encumbers cannot be attributed to an asset, the third gap survives
  its own fix with a better `why` rather than closing.
- **Whether a drawn line is already inside `balance`.** It decides whether the
  debt leg stands beside cash the account holds or beside nothing — and the
  second is a net figure short by the whole line. `fixtures/kraken/` holds the
  public responses only, so the schema is documented and the interaction is not.
