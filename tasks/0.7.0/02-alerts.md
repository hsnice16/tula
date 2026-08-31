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

Open question for the user: does this ship in 0.4.0 with the risk engine instead?
It is arguably the daily-driver hook, which would argue for earlier.
