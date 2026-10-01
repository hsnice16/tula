# 14 · What each venue states about a position, kept

**Status**: done, except Binance futures and Aave's rates
**Covered by**: `src/connectors/hyperliquid.test.ts`, `src/connectors/coinbase.test.ts`, `src/connectors/kraken.test.ts`, `src/core/detail.test.ts`

## Goal

The tester's second report (2026-09-28) asked to expand a position for "PnL/
Funding/etc". Most of that is already downloaded and thrown away: Hyperliquid's
`clearinghouseState` carries `entryPx`, `unrealizedPnl`, `returnOnEquity` and
`cumFunding` on every position in every capture under `fixtures/hyperliquid/`,
and `PerpPosition` in `src/connectors/hyperliquid.ts` dropped all four: `Position`
in `src/core/position.ts` had nowhere to put them.

This task carries them from each venue into the canonical model. Showing them is
[15](15-position-detail.md).

## Acceptance

- `Position` gains optional fields for entry price, unrealised PnL, return on
  equity, funding (since open, and all-time where stated), margin and
  margin mode — each absent where the venue does not state it, never zero.
  `Position.figures`; mark and leverage stay on `LiquidationParams`, where they
  already were, rather than a second copy. `currency` carries a figure stated in
  something other than dollars.
- Every field is the venue's own figure. None is derived from a cost basis:
  P&L reporting is out of scope in `ROADMAP.md`, and a wallet or spot row has no PnL here.
- Each venue's source for each field is read from a capture and cited in a
  connector test:
  - Hyperliquid — every field above, per dex, in every account mode. Asserted
    leg by leg against every capture, margin mode included.
  - Binance futures — **Not met.** No key tula stores can read futures: Binance's
    futures permission grants trading, and connect refuses such a key.
  - Coinbase perps — `vwap` as entry, `mark_price`, `unrealized_pnl`,
    `im_notional` as margin and `margin_type`, per the portfolio breakdown schema.
  - Kraken margin — unrealised P/L via `OpenPositions` with `docalcs`, and the
    initial margin, in the pair's quote currency. Rollover is not carried:
    `OpenPositions` states the rate (`terms`), not what was paid.
  - Aave — **Not met.** The supply and borrow rates are a separate decision.

  Coinbase and Kraken need a key, so their tests read the documented schema —
  Coinbase from `fixtures/coinbase/portfolio-breakdown.json`, Kraken from the
  example on docs.kraken.com/api/docs/rest-api/get-open-positions, `+` on `net`
  included. Both are to be recaptured when a key is to hand.
- A test per scaled asset: a `kPEPE`-style market stores size ×1000, so its
  entry and mark are ÷1000 or the figure is 1000× out. `kPEPE`, `kSHIB` and
  `kBONK` are in the captures and asserted.

## Notes

- **`equity` is not PnL.** It is zero on every Hyperliquid perp by design, because
  `accountValue` already contains the PnL. Reading it as PnL shows $0 on every
  Hyperliquid position.
- Under portfolio margin `liquidationPx` is null and the account ratio is what
  liquidates; that belongs beside the figures in 15, not in place of them.
- **Funding's sign.** Hyperliquid's docs do not state `cumFunding`'s sign. A
  third party checked it against `userFunding`, where the same amount is
  negative: positive `cumFunding` is paid
  (github.com/Boulou1/hl-leaderboard). The captures agree — the shorts mostly
  carry negative funding. 15 prints it as paid or received in words for that
  reason.
- A Kraken quote that is not a plain three- or four-letter code leaves the
  figures unstated: the code is printed beside them, and it is the venue's text.
