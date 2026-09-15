# 06 · Builder-deployed perp dexes (HIP-3)

**Status**: done, except a test over a position on a non-USDC dex
**Covered by**: `src/connectors/hyperliquid.test.ts`, `src/core/risk.test.ts`

## Goal

HIP-3 has been live on mainnet since October 2025. `perpDexs` lists the builder
dexes, and `clearinghouseState` answers for one only when the request names it
with `dex`. The connector never does, so a position on any of them is absent: an
account holding $11.9M across 22 positions on the `xyz` dex is shown as an empty
Hyperliquid book, and a unified account long NVDA there shows only its spot
USDC. The gap is declared and hides a liquidation; the tester met it as
"HIP-3 markets aren't shown".

## What the venue states

- **Names:** a market is `dex:ASSET` — `xyz:TSLA`.
- **Collateral per dex**, from `meta` with `dex`: USDC on some dexes, USDH,
  USDE or USDT0 on others.
- **Margin:** in standard mode each dex is margined on its own and has its own
  balance, shown as `USDC (Perps)` with the dex named. Under unified account and
  portfolio margin, cross positions share margin across dexes with the same
  collateral token.
- **Isolated-only is per asset, not per dex**: `marginMode: "noCross"` on some
  markets of a dex and not others, and enabling cross is irreversible.
- **Liquidation:** each dex has its own backstop liquidator, falling back to
  auto-deleveraging.

Sources: `hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-
perpetuals`, `trading/margining` and `for-developers/api/info-endpoint/
perpetuals` on `hyperliquid.gitbook.io`; `perpDexs` and `meta` on the public
info endpoint.

## Decided before building

- **Every dex is read, every refresh.** `clearinghouseState` weighs 2 against
  an IP budget of 1200 a minute
  (`https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits`),
  so eleven dexes cost 22, and `perpDexs`, `allPerpMetas` and `spotMeta` — 20
  each — cost more than all of them together. Reading only the dexes an account
  has touched needs a list the info API does not give: no per-user request names
  dexes, and the spot state names tokens, which several dexes share. "Touched"
  would be a guess, and a guessed dex is an unread liquidation.
- **A market keeps the name the venue writes, `dex:ASSET`,** and is its own
  asset. It does not go through `canonical()` — the venue's prefix already is the
  qualification `wallet.ts` builds for a contested symbol — and `unscale()` reads
  the part after the colon, so `xyz:kPEPE`-style names cannot unwind the prefix.
- **Left unpriced, with the distance to liquidation measured off the venue's own
  mark.** Pricing `xyz:TSLA` from Hyperliquid's mark would be a second price
  source in a process that has one: `/<source> status` says "every figure in tula
  is priced from here", and `tasks/the-shell/01-price-oracle.md` gives the reason —
  two sources summed into one aggregate disagree invisibly. Under `04`'s equity
  total an unpriced perp still contributes, because its PnL is in the dex's
  balance row, so nothing leaves the total. What an unpriced perp would lose is
  its distance, and that is not a valuation: it is the venue's `liquidationPx`
  against the venue's mark (`positionValue / |szi|`), two figures from one
  response, which is how an Aave health factor is already ranked. So a builder-dex
  perp carries that mark on its liquidation parameters, used only where the
  oracle has no price for the asset.

## Acceptance

- **Every dex `perpDexs` lists is read, or named as not read.** The fan-out is
  one `clearinghouseState` per dex per refresh on a list that only grows, so the
  design is settled in this file before building: read every dex, or read the
  dexes the account's own state says it has touched, bounded by Hyperliquid's
  published info rate limit — cited. Whatever is not read reaches the book as
  one line naming the dex and what it leaves out, under `INCOMPLETE`, never as
  silence.
- **A builder-dex market is its own asset.** `xyz:TSLA` does not net with a
  token called TSLA elsewhere and is not priced by a source's `TSLA` ticker. The
  qualified name follows the rule the wallet connector already applies to
  symbols that collide.
- **Priced or honestly unpriced.** Most of these markets are equities,
  commodities and indices no crypto price source quotes. Whether they are priced
  from the venue's own mark or left unpriced is decided here against
  `ROADMAP.md`'s single-oracle rule and its reason — two prices for one asset
  make the total disagree with itself — and the decision is written into this
  file before the code. A ticker collision is never the answer.
- **Each dex's balance in its own token.** Standard mode gets a perps row per
  dex in that dex's collateral token, valued at that dex's `accountValue`, as
  [`02`](02-balances-per-account-mode.md) does for the first-party dex. USDH,
  USDE and USDT0 are their own rows, per `src/connectors/symbols.ts`, and an
  unpriced one says so.
- **Margin mode per position**: a `noCross` market's position is isolated and
  claims no cross pool, and under unified and portfolio margin a cross position
  points at the spot row of its dex's collateral token.
- **The `k` multiple is unwound on the asset part only**, so a dex prefix can
  never be read as a thousand-multiple, pinned by a test.
- The declared gap comes out of `hyperliquid.ts` with the test holding it open,
  in the same change; `scripts/conformance.live.ts`'s builder-dex belief turns
  from "tula reads none of them" into "tula reads every dex listed";
  `ROADMAP.md`'s table loses the row.
- **Not met.** A test over a captured position on a dex whose collateral is not
  USDC. None exists to capture: on 2026-09-14 every market on the five such dexes
  was delisted and none of 297 recent traders on them held a position —
  [`01`](01-capture-every-account-mode.md) records what was asked. The token
  each dex is read in is held to the captured listing instead, and
  `bun run conformance` reports the day a position appears.
- Tests over `01`'s builder-dex captures.

## Notes

[`05`](05-account-wide-liquidation.md) needs these positions: the venue counts
every builder dex in the portfolio margin ratio, and the unified ratio groups
dexes by collateral token.
