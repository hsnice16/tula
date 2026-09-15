# 03 · What a portfolio-margin account has borrowed, and what secures it

**Status**: done
**Covered by**: `src/connectors/hyperliquid.test.ts`, `src/core/availability.test.ts`

## Goal

Portfolio margin pools spot and cross perps into one account: HYPE, BTC, USDC
and USDT count as collateral at a loan-to-value, and a shortfall is borrowed
automatically. The spot state says so per balance — `borrowed`, `supplied`,
`ltv`, `spotHold` — and the connector reads `coin` and `total` and nothing else.
So a borrow reaches the book as a negative spot row with nothing stating it is a
borrow, and the HYPE securing it is offered in the FREE column.

## What the venue shows

The Balances tab under portfolio margin names its column **Net Balance** —
"equity − borrowed amount" — adds **LTV** and **PM Cap Used**, and offers
**Repay** on a row whose total is negative. The account panel carries **Borrow
Cap Used** beside the Portfolio Margin Ratio. Sources: Hyperliquid's app bundle
(`https://app.hyperliquid.xyz/assets/`), `trading/portfolio-margin` and
`support/faq/portfolio-margin` on `hyperliquid.gitbook.io`.

## Decided before building

- **What a row is.** A negative Net Balance is a `debt` row — the borrow net of
  what the account holds in that token, which is the row the venue offers Repay
  on. Every other balance is a holding. A token that carries a loan-to-value and
  sits beside a borrow is `collateral`, and every row with `borrowed` above zero
  points at it, whatever its own sign: the fixture's USDC row nets positive and
  still carries the borrow the UBTC beside it secures.
- **The venue's figures beside it** travel on the row as `borrowing`:
  `borrowed`, `supplied`, `ltv`, and PM Cap Used — the app's
  `portfolioBorrowRatio` column, headed `portfolio.cap.used`, which reads
  `tokenToPortfolioBorrowRatio` for that token. The account's Borrow Cap Used is
  the same field for USDC: the app's portfolio-margin panel reads it for `USDC`
  and no other token.
- **Repay is named in the venue's words.** A collateral row held by a borrow says
  what releases it with the app's own string, "Repay borrows to withdraw
  collateral" (`available.to.withdraw.explanation`), under a reason of its own:
  Aave's release sentence is about a health factor of 1.00, which a
  portfolio-margin account does not have.
- **A portfolio-margin `hold` is never a reservation read as one.** It was
  negative on three accounts in four in `01`'s sample and `spotHold` did not match
  the resting orders on any, so a balance whose `hold` is negative is unprovable,
  and one pointed at by a borrow is claimed whole.
- **The borrow/lend book is the same money.** On the captured borrower
  `borrowLendUserState` states the USDC borrow at the spot state's `borrowed` and
  the UBTC supply at its `supplied`. A portfolio-margin account's book is
  therefore never added as rows, and `hyperliquid.test.ts` keeps the comparison.

## Acceptance

- **One row per token, as the venue draws it.** The row is the token's Net
  Balance — the spot `total`, which the venue defines as equity less borrowed and
  lets go negative — labelled Net Balance under portfolio margin, with
  `borrowed`, `supplied`, LTV and PM Cap Used stated beside it. No second row is
  drawn for the borrow: the venue shows one, and a debt row beside a Net Balance
  that already subtracts it counts the borrow twice.
- **Repay is the action named.** Where a Net Balance is negative,
  `availability()` names repaying it as what releases the collateral, as it
  already does for Aave, and the venue's own action is the word used. How the
  borrow is carried internally so that the collateral can point at it is free,
  provided no surface draws it as a row of its own.
- **Collateral is pledged, not free.** Each token counted toward the account at
  its `ltv` is pointed at by that debt, so the FREE column does not offer HYPE
  that is securing a USDC loan. The free figure per token is the one the venue
  states for it, and where the venue states none it is withheld with the reason,
  never the total.
- **A negative `hold` is unproven, not ignored.** It is live on real accounts
  and undocumented, so it renders through `Availability.unprovable` with the
  reason beside it until a source or a reconciliation over `01`'s captures says
  what it is. It is never netted into a free figure.
- `/hyperliquid status` states Net Balance, LTV and PM Cap Used per token, and
  Borrow Cap Used for the account, in the venue's words.
- **Not counted twice with the borrow/lend book.** `borrowLendUserState` is a
  separate declared gap in [`breadth/10`](../breadth/10-hyperliquid-depth.md).
  Before either lands, `01`'s portfolio-margin capture establishes whether a
  portfolio-margin borrow also appears there, and the test that establishes it
  is kept.
- Tests over `01`'s portfolio-margin captures: a borrower's USDC row equals the
  venue's Net Balance and states the borrowed amount, the book counts the borrow
  once, and a supplied HYPE balance is pledged, not free.

## Notes

The ratio this borrowing moves, and what it means for what breaks first, is
[`05`](05-account-wide-liquidation.md).
