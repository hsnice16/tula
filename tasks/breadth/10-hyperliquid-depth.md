# 10 · Hyperliquid depth

**Status**: done, except ranking the borrow/lend health factor, which the venue says does not liquidate
**Covered by**: `src/connectors/hyperliquid.test.ts`, `src/core/availability.test.ts`, `src/consistency.test.ts`

## Goal

Read the rest of a Hyperliquid account. Five declared gaps, and every one of them
is a public `info` endpoint that answers without a credential — the address is
the whole of what any of them takes.

Two of the five hide a liquidation, which is what puts this in **4** rather
than with the aggregator: nothing that can be called in is bought in.

The builder-deployed dexes were a sixth, and moved to
[`field-report/06`](../field-report/06-builder-dexes.md) when a tester met them
as missing markets.

## Decided before building

- **The spot hold is reconciled per row, as the acceptance below asks.** A hold
  equal to the resting spot orders that trade the token — sells by size, buys by
  quote notional — is an order hold; on a unified or portfolio-margin account the
  margin every dex draws on that collateral token counts beside them; anything
  else, and any negative hold, is unprovable with the reason. What
  [`field-report/01`](../field-report/01-capture-every-account-mode.md) measured
  is why no marker decides it: 29 of 40 standard USDC holds and 28 of 41 unified
  ones reconciled exactly, the rest by amounts no order explains.
- **The borrow/lend health factor is not a liquidation.** Hyperliquid's
  portfolio-margin FAQ says so in terms: "Health Factor <100% does not directly
  imply liquidation risk, but the account won't be able to borrow more"
  (`support/faq/portfolio-margin`), and the app's own explanation of it is "If this
  number is below 100%, the account cannot borrow more". Ranked in what breaks
  first it would claim an order the venue does not liquidate in, so it is stated
  on the account's entry beside the ratio that does liquidate it, and in
  `/hyperliquid status`, and never ranked. The declaration saying it hides a
  liquidation was wrong about what it hid.
- **The borrow/lend book is added only where the spot state does not already
  hold it.** On the captured portfolio-margin borrower every token in
  `borrowLendUserState` matches the spot state's `borrowed` and `supplied`; no
  account outside portfolio margin in a sample of 42 had anything in the book.
  So the book is read on every refresh and reconciled against the spot state,
  and a token it states that the spot state does not fails that part of the read
  by name rather than being added or dropped.
- **Staked HYPE is `staked`, and so is the staking balance.** The app names the
  account "Staking Balance + Total Staked"; both leave only through the 7-day
  unstaking queue ("Transfers from staking account to spot account have a 7 day
  unstaking queue", `hypercore/staking`). What is already in that queue,
  `totalPendingWithdrawal`, is `pending`: waiting is the only thing that moves it.
- **A vault equity counts toward the total and is not netted as USDC.** The venue
  states it in USD and pays a withdrawal in USDC less the leader's profit share
  (`hypercore/vaults/for-vault-depositors-legacy`), so it is value; but it is a
  claim on a pool whose positions the depositor does not hold, so it adds nothing
  to any asset's exposure. It lands as `lp` with no delta, and until
  `lockedUntilTimestamp` it is held — "Withdrawals are disabled for a lockup
  period after each of your deposits", in the app's words.
- **A sub-account is read as its own account**, through the same read as the
  master, under the label `hyperliquid-sub-<n>`: `subAccounts` names each one's
  own address, and each answers its own mode, dexes and ratio.
- **An isolated position's margin is carved out of its dex's balance** as its own
  claim beside the cross margin, and its liquidation price stays the venue's —
  never derived from the cross pool, which reports a stated isolated price wrong
  by 22%.

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
- **The captures come first**, and they are
  [`field-report/01`](../field-report/01-capture-every-account-mode.md): every
  account mode, portfolio margin's per-balance and account fields, and the new
  numeric fields filed under `AMOUNT` or `KEPT`. The account mode itself is read
  by [`field-report/02`](../field-report/02-balances-per-account-mode.md), so the
  USDC half above reconciles against a stated mode rather than inferring one.
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
  perp book, never averaged with it. Whether a portfolio-margin borrow also
  appears here is settled by
  [`field-report/03`](../field-report/03-portfolio-margin-borrowing.md) first,
  so the two are never counted twice.
- **Not met.** The borrow/lend health factor ranked in `whatBreaksFirst`. It is
  read and stated on the account's entry, in `/hyperliquid status` and to the
  model, and it is not ranked: Hyperliquid says "Health Factor <100% does not
  directly imply liquidation risk, but the account won't be able to borrow more"
  (`support/faq/portfolio-margin`), so a rank would place a borrowing limit among
  liquidations. The bullet above asks for what the venue says is not there, and
  wants re-arguing rather than building. A borrow/lend balance outside portfolio
  margin — none was found in 42 accounts sampled — fails that part of the read
  by name rather than being added.
- Each gap closed removes its `doesNotRead` entry and the test in
  `hyperliquid.test.ts` holding it open, in the same change.

## Notes

The HyperEVM entry this connector also declares is [`12`](./12-chain-reach.md)'s.
It is the one gap here that is not a call nobody makes.
