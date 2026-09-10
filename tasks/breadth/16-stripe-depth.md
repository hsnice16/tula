# 16 · Stripe depth

**Status**: planned

## Goal

Read the rest of what a Stripe key reaches. Two declared gaps, and neither is
machinery: `/v1/balance` answers for one kind of balance and for one account, and
the two gaps are another endpoint and another header on the same key.

The second is not a coverage question at all. A platform's connected accounts
hold money that is not the key holder's, and what tula may say about it is what
this file is mostly for.

## Acceptance

- **Connected accounts are somebody else's money, and that decides the bullet
  before the read does.** Every other gap in this tree is a total that is too
  small; this one closed carelessly makes a total that is too *large* — it states
  a figure the reader does not own and cannot spend. So the first thing to settle
  is whether they are read at all. Leaving the declaration standing is a
  legitimate outcome here, unlike anywhere else, provided its `why` is rewritten
  to say the reach was refused rather than missing.
- **If they are read, nothing that sums may see them.** Labelling is not enough
  on its own: a `stripe-connect:<id>` venue label is folded back into Stripe by
  `belongsToVenue`, and `Position.account` — which is how
  [`cross-domain/03`](../cross-domain/03-watched-addresses.md) keeps several
  addresses legible under one venue — attributes a row without exempting it, because
  there every address is the reader's. `netExposure` adds `delta` across whatever
  it is given. So this bullet is a row kind the totals refuse, honoured by
  exposure, `shock` and `breaks` alike, and its test is that a connected account
  holding a million changes no figure in the book. Build that before the fetch,
  not after it.
- The boundary is already drawn once in this connector, in the other direction:
  `connect_reserved` is money the platform holds *against* connected accounts and
  is the key holder's, which is why it is a row today. A connected account's own
  balance is the far side of the same line.
- **Treasury financial account balances** — a second call listing the financial
  accounts with the balance each one carries, plus the treasury permission on the
  restricted key. A key without it must degrade to what it can read; a venue that
  answers for the platform balance and fails whole because of a permission the
  reader never granted is worse than the gap.
- Each Treasury bucket earns `spot` or `pending` by the test the existing five
  were drawn by, and `available` keeps meaning available *in Stripe's sense* —
  payable on the payout schedule, not now. Do not reach for a `hides:
  'availability'` declaration to cover a bucket whose free figure is unclear:
  `venueFacts` in `src/core/coverage.ts` reads it venue-wide, so one such entry
  blanks the `FREE` column for every Stripe row, including the ones proven today.
- Each gap closed removes its `doesNotRead` entry and the test in
  `stripe.test.ts` holding it open, in the same change. The connected-account
  test asserts on request headers rather than URLs, because a `Stripe-Account`
  header is the only trace this read leaves.

## Notes

Unknown, and it decides the arithmetic: whether the money a financial account has
committed outbound is already deducted from its cash figure or sits beside it. If
it is inside and a row is added for it anyway, the same money is counted twice —
the failure mode the instant-payable slice was skipped to avoid in [`04`](./04-stripe-connector.md).
Stripe needs a key, so this is settled against the published schema or a live
read, not a captured fixture.

Also unknown: whether a restricted key can carry Treasury read without carrying
anything that writes. If it cannot, the gap stays shut — this product does not
ask for a key that can move money.
