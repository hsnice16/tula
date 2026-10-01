# 01 · Watch mode

**Status**: planned

## Goal

Positions whose figures refresh while the shell is open. The tester's second
report (2026-09-28) asked for positions that "update in realtime in terminal".
It follows the position detail in
[`field-report/14`–`16`](../field-report/README.md) as its own release.

## Acceptance

- **Starting a watch.** `w`, or a button, in the position detail modal from
  `field-report/15`. `/watch <asset|row>` does the same, `/watch` alone opens the
  watch list, `/unwatch` stops one or all. One-shot `tula watch` renders the
  watched set in place until ctrl+c, which restores the terminal.
- **A watch is on the account, not the row.** Under cross margin, a Hyperliquid
  unified or portfolio-margin account, or an Aave market, a position's
  liquidation price moves when any other position in the account moves.
  Refreshing one row would show a stale liquidation price as live. The detail
  shows the position with its account's ratio, both refreshed together.
- **An item under the input**, like Claude Code's background-task item:
  `2 watching · closest 8.2% from liquidation`. Selecting it (keys or mouse)
  opens the watch list; Enter on a row reopens the detail modal with the latest
  figures.
- **Only watched venues are polled.** Hyperliquid allows 1,200 info weight a
  minute per IP and a full refresh costs about 204, so roughly five a minute;
  polling just the watched accounts is what makes a short interval affordable.
  The interval respects each venue's published limit.
- **Every figure shows its age**, and a venue that fails to load is marked, not
  dropped — the thresholds are [`trust-surface/02`](../trust-surface/02-staleness-policy.md).
- **The transcript does not change.** A `/positions` printed earlier is a
  timestamped snapshot; only the watch surfaces are live.
- **Watches end with the shell**, and the watch list says so. Persisting them is
  a decision for [02](02-alerts.md).

## Open

- **Polling or streaming.** Polling positions every 15–30s ships first. Between
  polls, public price streams could reprice PnL and liquidation distance — but
  that figure is tula's arithmetic, not the venue's, and must say so with its own
  `asOf`. True push means a websocket per venue (Hyperliquid, Binance user data
  stream, Kraken, Coinbase) with reconnect and staleness of its own.
- **What "real time" means to the tester** — seconds, or 15–30s. It decides
  whether streaming is needed at all.
- **Order against milestone 9.** Proposed to follow the position-detail release
  directly, ahead of trust surface; `trust-surface/02` would come with it.

## Notes

This is where Ink earns its place - a live-updating view is what it is good at,
unlike the question-and-answer loop of the shell.
