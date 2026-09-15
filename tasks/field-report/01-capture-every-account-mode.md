# 01 · Capture every account mode Hyperliquid has

**Status**: done, except a capture on a dex whose collateral is not USDC
**Covered by**: `src/connectors/hyperliquid.test.ts`

## Goal

Every Hyperliquid fixture is the same kind of account, and it is not the kind
that shows the defect plainly. All six carry `tokenToAvailableAfterMaintenance`
and none carries `userAbstraction`, `portfolioMarginEnabled`, `borrowed`,
`supplied` or `spotHold`; five of them are HLP depositors, because that is where
the capture looks. No test here can see a standard account beside a unified
one, a portfolio-margin account, a borrow, or a builder dex — so the USDC row
could be wrong on every account in one regime and every test pass.

It did. The identity `hyperliquid.test.ts` asserts on each capture —
`accountValue = totalRawUsd + Σ sign(szi) × positionValue` — holds in every
account mode. A check that cannot fail in the mode where the figure is wrong
is what let an audit's finding ship as fixed.

## Acceptance

- **One capture per mode `userAbstraction` answers**: `disabled`, `default`,
  `unifiedAccount`, `portfolioMargin` — each file records the mode it was
  captured under, and `userAbstraction` is added to what the capture asks for.
- **The shapes that decide a figure**, each its own fixture:
  - a unified account holding a leveraged short — the tester's shape;
  - a portfolio-margin account with a non-zero `borrowed`, which is where a
    USDC `total` goes negative;
  - a portfolio-margin account posting HYPE or BTC as collateral;
  - a standard account holding both spot USDC and a perp, so the two halves the
    fix must not merge are both present;
  - an account with positions on at least one builder dex, and one on a dex
    whose collateral token is not USDC.
- **Not met.** The capture on a dex whose collateral is not USDC. Checked live
  on 2026-09-14 at 16:25 UTC: `perpDexs` lists eleven dexes, and `meta` with
  `dex` agrees with `allPerpMetas` on each one's `collateralToken`. Five are not
  USDC — `flx`, `vntl` and `km` on USDH, `hyna` on USDE, `cash` on USDT0 — and
  every market on all five is delisted (16, 15, 23, 25 and 17 of them). `para`,
  `mkts`, `io` and `abcd` are USDC. `recentTrades` on all 96 of those delisted markets named 297 traders; the
  last trade was on `hyna` on 2026-09-02, and `clearinghouseState` with `dex`
  showed none of the 297 holding a position on any of them. There is no position
  to capture. `bun run conformance` re-checks exactly this, and names
  `bun scripts/capture-onchain.ts --hyperliquid --only builder-dex-other-collateral`
  the day a position exists.
- **Where each shape was found is written in the capture script**, as
  `perp-isolated` already is. HLP depositors are one regime; `recentTrades`
  users and the leaderboard reach the others, through `--account`.
- **Every new numeric field is filed deliberately** in `scale()`: an amount
  (`borrowed`, `supplied`, `spotHold`, `tokenToAvailableAfterMaintenance`, a
  builder dex's balances) under `AMOUNT`, a ratio (`ltv`,
  `portfolioMarginRatio`, `tokenToPortfolioBorrowRatio`,
  `tokenToPortfolioSupplyRatio`) under `KEPT`. Scaling a ratio by the account's
  factor would make the capture disagree with itself.
- **Each mode's own relation is measured, then asserted** on every capture in
  that mode: how spot USDC `total` and `hold` relate to `accountValue`,
  `totalRawUsd` and `totalMarginUsed`, summed over the first-party dex and every
  builder dex. The live sample behind this task found spot USDC `total` equal to
  `accountValue` to the last digit on three unified accounts holding nothing
  else in USDC — that is the hypothesis the captures confirm or replace, and
  the test states what they show, not what this paragraph says.
- **A test on the figure, not only on the venue's arithmetic.** For every
  captured account, the USDC tula reports equals what the venue's own fields
  say that account holds under its mode. This is the assertion that did not
  exist.
- `scripts/conformance.live.ts` gains three beliefs, reporting rather than
  failing: the account modes a fresh sample of traders is spread across; that
  on unified and portfolio-margin accounts the spot state is where balances are
  stated; and that a builder dex added since `perp-dexs.json` was captured is
  named.
- `tasks/breadth/10-hyperliquid-depth.md` stops saying
  `tokenToAvailableAfterMaintenance` is absent from the fixtures.

## Measured

Over 109 accounts — `recentTrades` users on the majors, the HYPE and UBTC spot
pairs and every builder dex, read unscaled and not kept — before any fixture was
written. Counts are of rows or positions that satisfied the relation.

| Relation | disabled | default | unifiedAccount | portfolioMargin |
|---|---|---|---|---|
| accounts sampled | 56 | 8 | 41 | 4 |
| spot state carries `tokenToAvailableAfterMaintenance` | 0 / 56 | 0 / 8 | 41 / 41 | 4 / 4 |
| cross `liquidationPx` from that dex's `crossMarginSummary.accountValue − crossMaintenanceMarginUsed` | 957 / 998 | 69 / 69 | 8 / 86 | 0 / 4 |
| cross `liquidationPx` from `tokenToAvailableAfterMaintenance` for the dex's collateral token | — | — | 36 / 86 (the rest within 0.1%) | 4 / 4 |
| `tokenToAvailableAfterMaintenance(T) = total(T) − Σ crossMaintenanceMarginUsed(T) − Σ isolated margin(T)` | — | — | 36 / 41 pools | 0 / 4 |
| `Σ positionValue / (2 × maxLeverage)` over cross legs `= crossMaintenanceMarginUsed`, to the venue's six places | 68 / 79 | 10 / 11 | 33 / 33 | 3 / 3 |
| spot USDC `total = Σ accountValue` over USDC dexes | 0 / 40 | 0 / 4 | 2 / 10 | — |
| spot `hold` = resting spot orders, on a collateral token | 29 / 40 | 1 / 4 | — | — |
| spot `hold` = Σ `totalMarginUsed` + resting spot orders, no perp order open | — | — | 28 / 41 | 1 / 4 |
| spot `hold` negative | 0 | 0 | 0 | 3 of 4 accounts |

What that settles:

- **`default` is standard.** It carries no pooled figure and every liquidation
  price is priced off its own dex, exactly as `disabled`.
- **The hypothesis in the goal above is replaced.** Spot USDC equals the perp
  account value on 2 of 10 unified pools — only where nothing else is held in
  USDC. What holds on unified and portfolio margin is that the venue prices a
  cross position's liquidation off the collateral token's pool across every dex,
  so the spot `total` is marked to market and is the balance.
- **The per-mode assertion is the liquidation relation**, because it is the one
  that reads a different field in each mode: the dex's own cross account value in
  standard, the token's `tokenToAvailableAfterMaintenance` under unified and
  portfolio margin. `hyperliquid.test.ts` holds each capture to its mode's.
- **Holds reconcile against orders on some rows and not others.** Where they do
  not, the gap is the venue's calls landing a moment apart, or margin on open perp
  orders; neither is an order anybody could cancel. A portfolio-margin `hold` is
  negative on three accounts in four and is not a reservation at all.

## Notes

First because every task after it in this milestone is accepted by a test over
these files, and `AGENTS.md`'s rule stands: a fixture is captured, never typed.
The account shapes that reproduce the defect are described in
[`02`](02-balances-per-account-mode.md)'s notes, and found by the route above.
