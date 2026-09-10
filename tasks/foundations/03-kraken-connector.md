# 03 · Kraken connector

**Status**: done
**Covered by**: `src/connectors/kraken.test.ts`, `scripts/guard.sh`

## Goal

Read balances from Kraken with a query-only key, and prove at connect time that the
key cannot withdraw.

## Acceptance

- Request signing pinned to Kraken's published test vector in a unit test.
- An asset carries the name Kraken publishes for it, read from `altname` in the
  public asset list. Stripping the legacy `X`/`Z` prefix off a four-character
  code was the rule here first, and it is not a rule: nine enabled assets begin
  with X or Z and are four characters long without being prefixed at all, and
  Tether Gold was renamed to `AUT`. The prefix strip survives only as the
  fallback for a code the list did not carry, and it still leaves `XRP` and
  `XTZ` intact.
- `.S`/`.M`/`.B` yield suffixes map to `staked` and `.HOLD` to `pending`;
  duplicates merge into one exposure.
- `verifyScope` proves withdraw scope and reports trade scope as `unknown`.
- No order endpoint is called, including validate-only variants.

## Notes

Kraken exposes no endpoint that reports a key's permissions, and every endpoint
gated on trade permission mutates an order. `WithdrawMethods` is gated on
"Withdraw Funds" but only lists methods, so a success there is proof.
