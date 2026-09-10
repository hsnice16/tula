# 02 · Aave v3 connector

**Status**: done
**Covered by**: `src/connectors/aave.test.ts`, `src/site-claims.test.ts`

## Goal

The canonical "am I about to get rekt" number, plus the per-asset collateral and
debt legs that let Aave contribute to net exposure.

## Acceptance

- `getUserAccountData` gives total collateral, total debt, and health factor.
- Per-reserve aToken and variable-debt balances become `collateral` and `debt` positions.
- Debt is negative, and `encumbers` links each debt to its collateral.
- Health factor lands in `LiquidationParams.healthFactor`.
- Works against a public address across six markets on three chains: Ethereum's
  Core, Prime, EtherFi and Horizon, plus the Arbitrum One and Base deployments.
  Each chain is reached through its own entry in `src/connectors/chains.ts`;
  [`breadth/03-chain-coverage`](../breadth/03-chain-coverage.md) is where that
  registry came from.

## Notes

aTokens rebase, so a plain `balanceOf` returns the interest-inclusive figure and
no index math is required. Per-asset legs matter: an aggregate USD number cannot
contribute to per-asset net exposure, which is the whole thesis.
