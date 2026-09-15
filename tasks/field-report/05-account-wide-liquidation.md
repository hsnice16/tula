# 05 · Account-wide liquidation, under unified account and portfolio margin

**Status**: done
**Covered by**: `src/connectors/hyperliquid.test.ts`, `src/core/risk.test.ts`, `src/consistency.test.ts`

## Goal

`/breaks`, `/shock` and the agent's what-breaks-first rank every Hyperliquid
perp by its own `liquidationPx`. That is the trigger in standard mode only.
Under unified account and portfolio margin the venue liquidates the *account*,
on a ratio, and the per-position price is either absent or not the trigger — so
the order these commands claim is wrong for exactly the accounts carrying the
most cross-collateral.

## What the venue states

| Mode | What liquidates | Where it is stated |
|---|---|---|
| Standard | a cross position when Maintenance Margin / Portfolio Value reaches 100%; an isolated one on its own margin | `liquidationPx` per position |
| Unified | the account when the **Unified Account Ratio** passes 95%: the maximum, over collateral tokens, of cross maintenance margin summed across every dex using that token, over that token's spot total less isolated margin | computed from the documented function; not a field |
| Portfolio margin | the account when **Portfolio Margin Ratio** passes 0.95 | `portfolioMarginRatio` on the spot state; `liquidationPx` is null |

Sources: `trading/account-abstraction-modes`, `trading/portfolio-margin` and
`trading/liquidations` on `hyperliquid.gitbook.io`, and the ratio labels in the
app bundle at `https://app.hyperliquid.xyz/assets/`. Under unified the API still
returns a `liquidationPx` per position; whether it accounts for the ratio is
not documented, and is settled before anything ranks by it.

## Decided before building

- **The unified ratio is the app's own function.** The app's account panel
  computes Unified Account Ratio in the main bundle under
  `https://app.hyperliquid.xyz/assets/`: per collateral token, the sum of
  `crossMaintenanceMarginUsed` over every dex whose `collateralToken` is that
  token, divided by the token's spot `total` less the `marginUsed` of every
  isolated position on those dexes; the account's figure is the largest. That is
  the documented function, field for field. Two things the app does on top are not
  copied: it caps the figure at 100%, and it skips a token whose spot total less
  isolated margin is zero or less — both draw the most dangerous account as a
  safer one. Here a pool with maintenance margin and nothing left to hold it is
  liquidatable, and a figure past 100% is printed as it is. A pool token the spot
  state omits is read as a zero balance, so the account ranks as liquidatable
  rather than losing its ratio.
- **Portfolio Margin Ratio is `portfolioMarginRatio`** on the spot state, which is
  what the same panel renders. It is never recomputed: the documented function
  needs `min_borrow_offset`, borrow and supply caps and a borrow oracle price, and
  no per-account response states them — so a shocked portfolio-margin ratio is
  withheld with that reason.
- **Both liquidate past 95%.** "When the value is greater than 95%, your portfolio
  may be liquidated" is the explanation string for both ratios in the app's en-US
  strings.
- **An account ranks by `ratio / 0.95 − 1`**: the fraction of what the ratio is
  measured against that can go before it reaches the level. That is the same
  quantity a health factor ranks by, `1 / HF − 1`, so the two sort in one column
  without being averaged.
- **Unified `liquidationPx` does not rank.** `01` settles what it accounts for:
  on every captured unified and portfolio-margin position it is priced off the
  collateral token's `tokenToAvailableAfterMaintenance`, the pool across every
  dex — the price at which that pool reaches zero with every other position held
  still. The account is liquidated at 95%, before that, so the price is beyond the
  trigger. It stays on the row, as the venue shows it.
- **Under a shock the unified ratio moves on each cross leg's maintenance margin
  and PnL.** Maintenance is `positionValue / (2 × maxLeverage)` per leg — it sums
  to the venue's `crossMaintenanceMarginUsed` on 33 of 33 captured unified dexes —
  so a move scales it with the leg's notional, and the token's spot total moves by
  `szi × Δprice` summed over its legs. A move that would take a leg into another
  margin tier changes `maxLeverage`, which the response does not give for any size
  but the current one; that is stated beside the shocked figure, not modelled.

## Acceptance

- **The account is a rankable unit.** A unified or portfolio-margin account
  enters what-breaks-first as one entry carrying its ratio and the level it
  liquidates at, ranked beside Aave health factors and standard perps rather
  than averaged with them. Its perps are listed under it, not ranked on their
  own.
- **Portfolio margin: the ratio is read**, never recomputed for today's figure.
- **Unified: the ratio is computed** from the documented function and the
  fields it names, and a test over each unified capture in
  [`01`](01-capture-every-account-mode.md) holds it to that function, restated
  from the app's own code.
- **Held against the figure the venue's app draws**, derived rather than
  recorded: the app draws a ratio only for the wallet connected to it, but its
  code says exactly how, and `hyperliquid.test.ts` runs that derivation over
  every captured portfolio-margin and unified account and compares it with what
  tula prints. From the bundle under `https://app.hyperliquid.xyz/assets/`
  (checked 2026-09-14):
  - the account panel in `index-BeURO1RT.js` draws `Q(L * 100, 2) + '%'`, with
    `L = portfolioMarginRatio ?? 0` under portfolio margin and `L = Yd(...)`
    under unified, and turns the figure red past `L > 0.8`;
  - `Q` in `config-BdRWrCoz.js` is `toLocaleString(locale, { minimumFractionDigits:
    2, maximumFractionDigits: 2 })`, empty for null or NaN — two places, grouped;
  - `Yd` caps the unified figure at 1 and skips a pool whose spot total less
    isolated margin is zero or less; the Portfolio Margin Ratio is not capped;
  - Borrow Cap Used and PM Cap Used go through `z5`, `Math.min(value, 1)`, with a
    missing figure drawn as 0.00% or `-`.

  Decided per the venue: `marginRatio` groups thousands as `Q` does, and the two
  cap-used figures stop at 100% as `z5` stops them — a limit the venue enforces,
  not a liquidation. Not copied: `Yd`'s cap and skip, for the reason above, and a
  missing Portfolio Margin Ratio drawn as `0.00%`, which here is no entry at all
  rather than an account at no risk. tula rounds in decimal where the app rounds
  a float; the test holds them equal on every capture.
- **Under a shock the ratio is recomputed deterministically**, from the venue's
  stated maintenance margins, loan-to-values and balances, and a zero shock
  reproduces the ratio stated today to the digit. A ratio that cannot be
  recomputed for a shock — a missing input — withholds the shocked figure with
  the reason; it is not held constant.
- **Unified `liquidationPx` is not used for ranking** until a source or a
  captured liquidation shows what it accounts for. It is still shown where the
  venue shows it.
- **Builder dexes are in the ratio.** Hyperliquid states that every HIP-3 dex is
  included in portfolio margin and that the unified ratio groups dexes by
  collateral token, so the ratio is not complete until
  [`06`](06-builder-dexes.md) reads them. Until then the account's entry says
  which dexes it did not read.
- **Until this lands, the gap is declared.** A `doesNotRead` entry with
  `hides: 'liquidation'` for the account ratio under unified and portfolio
  margin, so `/breaks` and `/shock` say the order may be wrong for such an
  account — the one exception `AGENTS.md`'s disclosure rule already makes for
  those two commands. It can land before the rest of this task and is removed
  by it.
- The ratio is rendered by `src/core/format.ts`, and the agent's tools state it
  already rendered; `src/consistency.test.ts` holds `/breaks` and the tool to the
  same order.
- **A dex that does not load.** The Unified Account Ratio is computed over the
  dexes that did, prints as `at least` that figure, and still ranks the account:
  an unread dex only adds maintenance and isolated margin. Under a shock it is
  withheld, since an unread leg's PnL can move it either way. The Portfolio
  Margin Ratio is the venue's whole-account figure and is unaffected. Covered by
  `hyperliquid.test.ts` and `risk.test.ts`.

## Notes

Standard mode's cross margin ratio needs no work: each position's
`liquidationPx` already embodies it, and the connector quotes the venue rather
than deriving one.
