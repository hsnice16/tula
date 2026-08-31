# 04 · Cross-domain fixture

**Status**: deferred

## Goal

Extend the demo fixture to the README scenario, so the cross-domain answer is
testable and demonstrable without three real accounts.

## Acceptance

- Long ETH spot, short ETH perp with a liquidation price, ETH collateral with USDC debt.
- `exposure` nets to one ETH figure; `breaks` orders the two liquidation risks correctly.
- The fixture is the regression test for the aggregation math.

## Why this was dropped from the product

The fixture venue was removed entirely. Hyperliquid and Aave read from a public
address, so any address exercises the full cross-domain path against real data —
a fixture beside real venues was a liability, not a convenience. The scenario
survives as a connector defined inside `src/cli/shell.test.ts`, where it is
unambiguously test-only.
