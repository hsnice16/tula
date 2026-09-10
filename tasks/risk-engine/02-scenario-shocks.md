# 02 · Scenario shocks

**Status**: done
**Covered by**: `src/core/risk.test.ts`, `src/consistency.test.ts`, `src/agent/tools.test.ts`, `src/cli/shell.test.ts`

## Goal

Answer "what happens at -20%" over the whole cross-venue portfolio at once.

## Acceptance

- `shock ETH -20` reprices every ETH leg on every venue and reports the change.
- Multiple simultaneous shocks are supported.
- Positions that would liquidate under the shock are listed explicitly.
- Unpriced assets are named as excluded rather than silently treated as unchanged.
- Health factors are recomputed under the shock, with the stablecoin-debt
  assumption stated — to the reader, and only where this book breaks it.
  `ShockedHealthFactor.debt` is the assumption checked against the positions:
  null where the shock touches nothing the market borrowed, and otherwise the
  borrowed assets it moves and which way the true factor sits from the one
  shown. `/shock` prints it under the row and `run_scenario` carries it beside
  the figure. Said under every figure it would be a line nobody reads; said
  here it is the difference between a number to act on and one that is wrong on
  the side that matters.
