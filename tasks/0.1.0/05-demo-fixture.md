# 05 · Opt-in demo fixture

**Status**: done · removed in 0.3.0

## Goal

Make the whole flow drivable without a venue account, so the UX can be judged
without risking a real key.

## Acceptance

- Registered only when `TULA_DEMO` is set.
- Exercises the real code path, including the credential store.
- One row is deliberately stale so the freshness column is visibly working.

## Notes

Opt-in so the shipped binary never lists a fake account beside a real one.

## Removed in 0.3.0

Deleted along with every other piece of stand-in data. Hyperliquid and Aave read
from a public address, so a real venue now does what this was for, and a stand-in
account sitting beside real ones was a liability rather than a convenience.
