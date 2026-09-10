# 01 · Liquidation distance

**Status**: done
**Covered by**: `src/core/risk.test.ts`, `src/core/gates.test.ts`, `src/agent/tools.test.ts`

## Goal

For every position that can be liquidated, the size of the adverse price move that
would do it - expressed the same way regardless of venue.

## Acceptance

- A signed fraction: -0.35 means a 35% fall triggers it, +0.22 a 22% rise.
- Derived from a health factor where there is one, and from a liquidation price
  where there is not. `liquidationRisk` checks the health factor first.
- Health factor at or below 1 reports zero distance, not a negative one.
- A position with no liquidation data reports `null`, which sorts last and never reads as safe.

## Notes

One comparable number across a perp liquidation price and an Aave health factor is
what makes "what breaks first" answerable at all.
