# 01 · Canonical position schema

**Status**: done

## Goal

One shape that a CEX balance, a perp position and a lending collateral leg all map
into, so netting across them is a plain sum rather than per-venue special cases.

## Acceptance

- `Position` carries signed `quantity`, explicit `delta`, and `asOf`.
- `NetExposure.asOf` is the *oldest* contributor, not the newest.
- `LiquidationParams` covers both a liquidation price and a health factor.
- `encumbers` links positions margined against each other.

## Notes

`delta` is stored rather than derived because it equals `quantity` for spot and
perps but diverges for LP and options. Deriving it at aggregation time means
rewriting the risk engine the day a Uniswap position appears.
