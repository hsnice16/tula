# 01 · Hyperliquid connector

**Status**: done

## Goal

Perp positions with real margin and liquidation data, read from a public address
with no API key at all.

## Acceptance

- Reads `clearinghouseState` and `spotClearinghouseState` for an address.
- Perp positions map to signed `quantity` with `liquidation.price` and leverage.
- Spot balances map to `spot` positions.
- `verifyScope` returns read-only true with nothing unknown - there is no key.
- Unit tests over a recorded API response, not a live call.

## Notes

The first venue needing no credential at all, which is why the connect flow must
already distinguish a key paste from an address.
