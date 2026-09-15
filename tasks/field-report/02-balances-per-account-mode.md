# 02 · Hyperliquid balances as the venue states them, in each account mode

**Status**: done
**Covered by**: `src/connectors/hyperliquid.test.ts`, `src/consistency.test.ts`

## Goal

The connector emits every spot balance and, beside them, a USDC `collateral`
row of `marginSummary.totalRawUsd`, whatever mode the account is in. Two
defects follow, and a tester found both without sharing the account:

- **On unified and portfolio-margin accounts the USDC is counted twice.**
  Hyperliquid states those accounts' balances in the spot clearinghouse state
  and says per-dex perp states "are not meaningful". The spot USDC already holds
  what the perps are margined from, and the `collateral` row adds it again.
- **In every mode the row is a figure the venue never shows.** `totalRawUsd` is
  `accountValue − Σ signed notional`, so behind a short it is the account's
  equity plus the short's notional — "the usdc notional is somehow plus to
  collateral", in the tester's words.

The 0.2.0 audit found the first defect — 22.2M USDC printed on a 1.87M account,
25 of 40 sampled accounts unified — and the fix that shipped moved the row from a
holding to `collateral` without removing it. It was tested by the venue's
identity, which holds in every mode; [`01`](01-capture-every-account-mode.md) is
the test that would have failed.

## What the venue shows

Read from Hyperliquid's own app bundle and docs:

| Mode | Balances | Perps | Account risk |
|---|---|---|---|
| Standard (`disabled`, `default`) | `USDC (Spot)` and one `USDC (Perps)` per dex | valued at `accountValue`, "Balance + Unrealized PNL"; its Balance is `accountValue − Σ unrealizedPnl` | Cross Margin Ratio; each position's `liquidationPx` |
| Unified (`unifiedAccount`) | one `USDC` row, from the spot state | no balance row of their own | Unified Account Ratio |
| Portfolio margin (`portfolioMargin`) | as unified, the column named Net Balance, which can be negative | none | Portfolio Margin Ratio; `liquidationPx` is stated, priced off the token pool as under unified (4 of 4 captured positions) |

`totalRawUsd` and a short's proceeds appear in none of them. Sources:
`https://app.hyperliquid.xyz/assets/` (the English string file and the account
and balances components), `trading/account-abstraction-modes`,
`trading/margining`, `trading/portfolio-margin` and `for-developers/api/
info-endpoint/spot` on `hyperliquid.gitbook.io`; ccxt reads the mode through
`userAbstraction` for the same reason (ccxt issue 28093).

## Decided before building

- **`disabled` and `default` are read as standard.** `userAbstraction`'s values
  are `unifiedAccount`, `portfolioMargin`, `disabled`, `default` and
  `dexAbstraction` (`for-developers/api/info-endpoint`); `default` measured as
  standard on every relation in [`01`](01-capture-every-account-mode.md).
  `dexAbstraction` is documented as discontinued and fails by name, as does any
  value added later.
- **A standard dex's balance row** is kind `collateral`, in that dex's
  collateral token, valued at `accountValue`. The venue's own row is "USDC
  (Perps)" with the dex named beside it (`balanceType: { type: 'perps', name }` in
  the app's balances component), so the first-party dex's row sits under the
  venue label `hyperliquid` and a builder dex's under `hyperliquid-<dex>`, the
  convention a venue's market already uses. Its Available Balance is
  `withdrawable`: the same component hands that row `withdrawable` as its
  available figure.
- **A spot row's Available Balance is `total − hold`**, the function the app's
  Available Balance column renders (`L5` in the app's config chunk).
- **What is checked against what on every read**, because each held on every
  account in `01`'s sample: the mode against the shape of the spot state — a
  unified or portfolio-margin account carries `tokenToAvailableAfterMaintenance`
  and a standard one does not, and `portfolioMarginEnabled` is true exactly on
  `portfolioMargin` — and on every dex, `accountValue = totalRawUsd + Σ sign(szi)
  × positionValue`. A disagreement fails the venue naming the account, with no
  USDC figure. Spot USDC against account value is not among them: it holds on
  2 of 10 unified pools.

## Acceptance

- **The mode is read, on every refresh**, from `userAbstraction`. A value this
  build does not handle — `dexAbstraction`, or one added later — fails the venue
  by name with the mode it answered, and no USDC figure is printed. A guessed
  mode is a guessed balance.
- **Standard:** spot rows as before; one perps balance row per dex, labelled as
  the venue labels it and valued at `accountValue`. The builder-dex rows arrive
  with [`06`](06-builder-dexes.md).
- **Unified and portfolio margin:** balances come from the spot state alone. No
  perps balance row is emitted and `marginSummary` is not read for a balance.
  Positions still come from each dex's `assetPositions`.
- **`totalRawUsd` is emitted nowhere.** The identity test stays as a check on
  the venue; it is no longer the source of a row.
- **Where the mode and the arithmetic can disagree, they are checked against
  each other.** Wherever `01` finds a relation that holds exactly in a mode, it
  is checked on every read, and a disagreement makes the venue `INCOMPLETE`
  naming the account, rather than printing either figure. A marker is a fact
  about Hyperliquid today; a reconciliation is not.
- **The free figure is the venue's Available Balance**, from the field the
  venue's own app reads for that column, named in the connector.
- **Cross positions encumber the row their margin is actually drawn from** —
  the dex's perps row in standard mode, the collateral token's spot row under
  unified and portfolio margin — so `availability()` subtracts from the right
  holding.
- The connector's `coverage.reads` stops describing a cash leg.
- `hyperliquid.test.ts`, over `01`'s captures: in each mode, the USDC tula
  reports equals the venue's own figure; the tester's shape — a unified account
  holding a leveraged short — is its own case.
- `CHANGELOG.md` says plainly that the 0.2.0 entry on this row fixed one case
  and left two, and what a unified or portfolio-margin account was shown.

## Notes

It reproduces on live accounts of two shapes: a unified account whose spot USDC
is many times its perp account value, and a standard account holding a short,
whose `totalRawUsd` exceeds its account value by the short's notional. No
account is named here: a fragment of an address beside its balances identifies
it. `01` finds accounts of each shape — `recentTrades` users, filtered by
`userAbstraction`.

When this ships, ask the tester to open their account again and say whether the
rows match what the venue shows them. That is the only check made against the
account that reported it.
