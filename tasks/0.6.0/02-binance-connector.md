# 02 · Binance connector

**Status**: done

## Goal

The largest CEX, with spot, futures and margin - so it needs real liquidation math
and belongs in tier 1.

## Acceptance

- Spot, cross margin and futures positions.
- `verifyScope` uses `apiRestrictions`, which unlike Kraken does report permissions.
- Futures positions carry a liquidation price.
- A key with trade or withdraw permission is refused.

## Notes

Binance can prove all three scopes, so `canTrade` is a real boolean here. That
contrast is worth surfacing in the connect output.
