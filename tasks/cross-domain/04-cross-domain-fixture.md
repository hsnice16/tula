# 04 · Cross-domain fixture

**Status**: done · as a test-only connector; the demonstrable half was refused
**Covered by**: `src/cli/shell.test.ts`

## Goal

Extend the demo fixture to the README scenario, so the cross-domain answer is
testable and demonstrable without three real accounts.

## Acceptance

- Long ETH spot, short ETH perp with a liquidation price, ETH collateral with USDC debt.
- `exposure` nets to one ETH figure; `breaks` orders the two liquidation risks correctly.
- The fixture is the regression test for the aggregation math.

## Why this is not `deferred`

`deferred` reads as an invitation to pick the work up, and picking this up as
written means putting a stand-in venue beside real ones. That was decided, not
postponed: `scripts/guard.sh` refuses the language that named it, and stands as
the evidence against the fixture itself. Nothing here is waiting for anyone.

The three bullets above landed; only the demo half was refused. The fixture
venue was removed from the product entirely: Hyperliquid and Aave read from a
public address, so any address exercises the full cross-domain path against real
data, and a stand-in account beside real ones was a liability rather than a
convenience — `foundations/05` records the same removal. The scenario survives
as a connector defined inside `src/cli/shell.test.ts`, where it is unambiguously
test-only: long ETH spot, a short ETH perp carrying a liquidation price, and ETH
collateral against USDC debt, with the tests that net it to one ETH figure and
order the two liquidations.
