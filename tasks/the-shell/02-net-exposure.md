# 02 · Net exposure aggregation

**Status**: done

## Goal

Turn a list of balances into the answer: the same asset held three ways is one
number. This is the thing no venue will build.

## Acceptance

- Nets signed deltas per asset across venues and position kinds.
- Inherits the oldest contributor's `asOf`.
- `notional` is null without a price; `portfolioValue` names what it excluded.
- Ranks by absolute notional, unpriced last.
- Unit tests cover the spot/perp/collateral case from the README.

## Notes

Built in `src/core/exposure.ts` and tested; not yet surfaced by a command.
