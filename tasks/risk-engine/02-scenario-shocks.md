# 02 · Scenario shocks

**Status**: done

## Goal

Answer "what happens at -20%" over the whole cross-venue portfolio at once.

## Acceptance

- `shock ETH -20` reprices every ETH leg on every venue and reports the change.
- Multiple simultaneous shocks are supported.
- Positions that would liquidate under the shock are listed explicitly.
- Unpriced assets are named as excluded rather than silently treated as unchanged.
- Health factors are recomputed under the shock, with the stablecoin-debt assumption stated.
