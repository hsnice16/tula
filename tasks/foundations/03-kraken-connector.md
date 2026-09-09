# 03 · Kraken connector

**Status**: done

## Goal

Read balances from Kraken with a query-only key, and prove at connect time that the
key cannot withdraw.

## Acceptance

- Request signing pinned to Kraken's published test vector in a unit test.
- Legacy `X`/`Z` prefixes stripped on four-character codes only; `XRP` and `XTZ` survive.
- `.S`/`.M`/`.B` yield suffixes map to `staked`; duplicates merge into one exposure.
- `verifyScope` proves withdraw scope and reports trade scope as `unknown`.
- No order endpoint is called, including validate-only variants.

## Notes

Kraken exposes no endpoint that reports a key's permissions, and every endpoint
gated on trade permission mutates an order. `WithdrawMethods` is gated on
"Withdraw Funds" but only lists methods, so a success there is proof.
