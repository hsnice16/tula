# 02 · Binance connector

**Status**: done · spot and margin; futures is written and unreachable
**Covered by**: `src/connectors/binance.test.ts`, `src/core/availability.test.ts`

## Goal

The largest CEX, with spot, futures and margin - so it needs real liquidation math
and belongs in tier 1.

## Acceptance

- Spot positions, from `/api/v3/account`, with `free` and `locked` kept apart:
  locked is exposure and is not yours to move, and summing it into the free
  figure answered the wrong question.
- Cross and isolated margin, from `/sapi/v1/margin/account` and
  `/sapi/v1/margin/isolated/account`. Both carry a liquidation price and a margin
  level that appear in no other endpoint. Whether reading them needs the borrow
  permission is undocumented in either direction, so the call is made and a
  permission refusal is read as an account with no margin on it; anything else
  fails the venue.
- Futures positions carry a liquidation price. **Written and unreachable**:
  `enableFutures` sets `canTrade`, so connect refuses every key that could read
  them. Kept because the refusal is the thing that could change.
- `verifyScope` uses `apiRestrictions`, which unlike Kraken does report permissions.
- A key with trade or withdraw permission is refused, and so is one that can take
  a margin loan or move funds between wallets — `enableMargin`,
  `enableInternalTransfer` and `permitsUniversalTransfer` are none of them a
  trade or a withdrawal, and all three passed the gate until `KeyScope` gained
  the axis they sit on.
- What is left unread is declared in the connector's own `coverage`, so it
  reaches the `NOT READ` line: the margin level a cross account is liquidated at,
  COIN-M and Portfolio Margin, the funding wallet and the earn products,
  balances frozen or withdrawing, and sub-accounts.

## Notes

Binance can prove all three scopes, so `canTrade` is a real boolean here. That
contrast is worth surfacing in the connect output.
