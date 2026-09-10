# 01 · Single price oracle

**Status**: done
**Covered by**: `src/prices/coingecko.test.ts`, `src/core/exposure.test.ts`

## Goal

One price source for the whole process, so aggregate exposure cannot silently
disagree with itself. CoinGecko first.

## Acceptance

- Implements `PriceOracle` from `src/core/prices.ts`.
- `quoteMany` batches: the whole book costs the same fixed number of market
  pages however many assets are in it, cached for the minute after.
- Every quote carries its own `asOf`; a stale quote is never rendered as live.
- An unavailable price yields `null` notional, never zero.
- Symbol-to-id mapping is unit-tested for the ambiguous tickers.

## Notes

If Kraken says ETH 4010 and an on-chain oracle says 4003, mixing them makes the
aggregate inconsistent in a way nobody can see. One oracle, always.
