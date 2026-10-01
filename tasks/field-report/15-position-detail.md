# 15 · One position's detail, as a modal and as a command

**Status**: done
**Covered by**: `src/core/detail.test.ts`, `src/consistency.test.ts`, `src/agent/tools.test.ts`, `src/ui/screen.test.ts`

## Goal

Show one position's figures from [14](14-position-figures.md) in a detail view
opened from the picker in [16](16-position-picker.md), and from a command, so the
one-shot CLI and the agent reach it too — every view has a command behind it.

## Acceptance

- `/position <asset> [venue, kind, account or product]` opens the detail; one-shot `tula position BTC` prints it.
  An asset held at more than one venue lists the matches rather than guessing.
  The words after the asset narrow it — venue, kind, account or product — and
  each match is listed with the words that name it alone. In the shell the list
  is the picker, filtered.
- In the shell the detail is a modal over the screen, built the way the `ctrl+s`
  palette is (`src/ui/Palette.tsx` draws over a copy of what is behind it,
  because the `<Static>` transcript is not in Ink's grid).
- It shows: size, entry, mark, unrealised PnL and ROE, funding, margin and
  leverage, liquidation price and distance, venue, account, product and `asOf`.
  The labels follow the venues' own positions views, cited below.
- A figure the venue does not state reads as not stated, never as zero.
- Where the venue liquidates the account rather than the position (Hyperliquid
  unified and portfolio margin, an Aave market), the account's ratio and
  trigger are shown with the position, and the position's own liquidation
  price is marked as not what liquidates it. Under cross margin the detail says
  the price moves with the rest of the account.
- The agent gets the same view as a tool result, `get_position`; no figure in
  it is the model's. `RiskEngine.position` builds it, since the value and the
  distance need prices, which do not cross the boundary.

## The standard it follows

Sections, so one layout serves every kind of holding: Position, PnL, Liquidation,
Holding, Source. A section with nothing to say for a kind of row is left out
rather than filled with "not stated" — an unstated liquidation price on a USDC
balance that margins a perp is a row about a trigger the balance does not have.

A perp's rows are the fields both venues checked name: Hyperliquid's Positions
tab, read live on app.hyperliquid.xyz/trade on 2026-09-30 — Market, Size,
Position Value, Entry Price, Mark Price, PNL (ROE %), Liq. Price, Margin,
Funding — and Binance futures' Positions tab, which names Entry Price, Mark
Price, Liq. Price, Margin Ratio and PNL (ROI %)
(binance.com/en/support/faq/how-to-calculate-profit-and-loss-for-futures-contracts-3a55a23768cb416fb404f06ffedde4b2).
The sections set the order. The labels are Hyperliquid's for Entry Price, Mark Price, Liq. Price and Margin; PnL reads `Unrealised PnL`, ROE beside it.

Hyperliquid's Funding tooltip: "Net funding payments since the position was
opened. Hover for all-time and since changed." — `cumFunding.sinceOpen`, with
`allTime` beside it. The current rate is on the market header only, never per
position. Whether the app negates the API's sign could not be seen, so the
detail says paid or received in words.

The distance to liquidation is worded as `/breaks` heads the same figure. A
perp's value is its notional, unsigned as venues print it; a debt's is negative.

## Notes

The modal is also what [`watch-and-alerts/01`](../watch-and-alerts/01-watch-mode.md)
reopens with live figures, and where `w` starts a watch. Leave room for the
action row; do not build it here. The footer line is that room.

The detail takes the rows it needs, up to the screen: capped at the palette's
twelve, the sentence saying the account is what liquidates was below the fold on
a 34-row terminal.
