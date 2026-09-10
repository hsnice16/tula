# 10 · Hyperliquid depth

**Status**: planned

## Goal

Read the rest of a Hyperliquid account. Six declared gaps, and every one of them
is a public `info` endpoint that answers without a credential — the address is
the whole of what any of them takes.

Three of the six hide a liquidation, which is what puts this in **4** rather
than with the aggregator: nothing that can be called in is bought in.

## Acceptance

- **The spot hold, which is not an order hold.** `hold` is on every balance the
  connector already parses and is discarded, so this looked like a decode. It is
  not. Measured over 169 live accounts: on a **non-USDC** balance it is exactly
  the resting orders — 469 of 474 rows reconcile against `frontendOpenOrders` to
  1e-10, counting sells by base size and buys by quote notional. On **USDC** it
  depends on which margin regime the account is in, and the account says which:
  where `tokenToAvailableAfterMaintenance` is present — two thirds of the sample
  — `hold` also carries perp margin, and reconciles as resting USDC buys plus
  `totalMarginUsed` on the first-party dex plus the same on each builder dex
  plus `1.01 ×` the margin on exposure-increasing open perp orders. Where it is
  absent, `hold` is the buys alone and excludes perp margin entirely. On five
  accounts `hold` *was* the perp margin to the last digit with no order at all,
  and on a portfolio-margin borrower it was **negative**.
  So the acceptance is not "read `hold`". It is that nothing names an order as
  the thing to cancel unless this account's own resting orders account for it —
  reconciled per row rather than switched on the regime marker, because a marker
  is a fact about today's Hyperliquid and the reconciliation is not. What the
  orders do not account for is a hold whose reason is unproven, which
  `Availability.unprovable` already renders as an em dash with the reason
  beside it.
  Closing the non-USDC half alone is worth doing on its own and is the smaller
  piece. It does not retire the declaration, because the declaration is about
  the USDC row.
- **Recapture before any of the above.** `spotClearinghouseState` now returns
  `spotHold`, `borrowed`, `supplied`, `ltv` per balance and
  `portfolioMarginEnabled`, `portfolioMarginRatio`,
  `tokenToAvailableAfterMaintenance` and `tokenToPortfolioBorrowRatio` on the
  account. None is in `fixtures/hyperliquid/*.json`, so no test here can see the
  regime that decides what `hold` means. `scale()` in the capture throws on a
  numeric field it does not classify, so each has to be filed under `AMOUNT` or
  `KEPT` deliberately — which is the check working, not an obstacle.
- **The isolated-position margin split.** The fixture blocker is gone:
  `fixtures/hyperliquid/perp-isolated.json` holds an isolated BTC leg beside two
  cross ones, and `hyperliquid.test.ts` pins the arithmetic —
  `crossMarginSummary.totalMarginUsed` excludes the isolated margin and
  `marginSummary.totalMarginUsed` includes it, so reading the second as the
  cross pool overstates it by a whole position's margin. Finding it needed a
  second address source: **no HLP depositor holds an isolated position** — 0 of
  the 99 addresses the capture reads — while 13 of the top 200 of the public
  mainnet leaderboard did, and 5 held both kinds at once. `--account <address>`
  captures one by name for that reason.
- **An isolated leg's liquidation price does not come off the cross pool**, and
  that is the sharper half of this gap. The relation `hyperliquid.test.ts`
  checks every cross leg against — position value against spot USDC less the
  cross maintenance margin — reports the venue's own stated price for an
  isolated leg as wrong by 22%. So a build that ever computes a liquidation
  distance itself, rather than quoting `liquidationPx`, gets an isolated
  position badly wrong. Nothing does today; the connector quotes the venue. The
  acceptance is that it stays that way, or that the isolated case is derived
  from the margin posted to that leg alone.
- **Staked HYPE and vault deposits** — `delegatorSummary` and
  `userVaultEquities`. A vault equity is a claim on a pool rather than a
  balance, so what it lands as, and whether it can be netted, is the question to
  settle before a row is drawn.
- **Sub-accounts** — `subAccounts`. Each answers under its own address, so this
  is the same shape [`cross-domain/03`](../cross-domain/03-watched-addresses.md)
  built for a venue holding several accounts, discovered rather than typed.
- **The borrow/lend book** — `borrowLendUserState`, which returns its own
  `healthFactor`. That makes it risk-engine work, not a balance: a second health
  factor under one venue has to reach `whatBreaksFirst` and be ranked beside the
  perp book, never averaged with it.
- **Builder-deployed dexes.** `perpDexs` lists them and `clearinghouseState`
  takes a `dex` parameter. The list grows without bound and is one call each, so
  the design question is the fan-out per refresh — read only the dexes an
  account has touched, or bound it — not whether the data is reachable.
- Each gap closed removes its `doesNotRead` entry and the test in
  `hyperliquid.test.ts` holding it open, in the same change.

## Notes

The HyperEVM entry this connector also declares is [`12`](./12-chain-reach.md)'s.
It is the one gap here that is not a call nobody makes.
