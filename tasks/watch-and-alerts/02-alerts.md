# 02 · Threshold alerts

**Status**: planned

## Goal

Notify before a threshold is crossed, not after.

## Acceptance

- Thresholds on health factor, liquidation distance, and net exposure per asset.
- Notifications through the OS, and optionally a webhook.
- An alert states which venue and which number, with its `as_of`.
- An alert never fires on stale data without saying that it is stale.

## Notes

The watched set in [01](01-watch-mode.md) is where a threshold attaches, and
whether a watch outlives the shell is decided here.

This asked whether alerts should ship with the risk engine. They did not — the
engine shipped in 0.1.0 without them — and the question stands answered by
`ROADMAP.md` putting this at milestone 10, ahead of every new capability. It is
the daily-driver hook, and a risk tool you have to remember to open is one you
forget.
