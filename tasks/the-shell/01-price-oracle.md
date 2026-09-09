# 01 · Single price oracle

**Status**: done

## Goal

One price source for the whole process, so aggregate exposure cannot silently
disagree with itself. CoinGecko first.

## Acceptance

- Implements `PriceOracle` from `src/core/prices.ts`.
- `quoteMany` batches; a portfolio of 30 assets is one request.
- Every quote carries its own `asOf`; a stale quote is never rendered as live.
- An unavailable price yields `null` notional, never zero.
- Symbol-to-id mapping is unit-tested for the ambiguous tickers.

## Notes

If Kraken says ETH 4010 and an on-chain oracle says 4003, mixing them makes the
aggregate inconsistent in a way nobody can see. One oracle, always.
