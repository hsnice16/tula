# 04 · Stripe connector

**Status**: done

## Goal

The first non-crypto venue. A business's settled fiat balance is part of the same
picture as its positions, and no crypto tool shows both.

## Acceptance

- Available and pending balances, per currency, from a restricted (`rk_`) key.
- Pending is its own row: it is yours but not yet movable.
- Minor units are resolved per currency — zero-decimal (JPY, KRW, …) and
  three-decimal (KWD, …) currencies are not divided by 100.
- A publishable (`pk_`) key is rejected with the reason.
- A secret (`sk_`) key reports `canTrade` and `canWithdraw` true, so the connect
  flow refuses it — it can create payouts and transfers.
- Trade and withdraw stay `unknown` for a restricted key: Stripe does not report
  what one is permitted to do.

## Notes

Non-USD fiat has no price source yet, so those balances carry a null notional and
are named as excluded from the total rather than silently dropped.

Stripe is the venue that makes the product's name literal: exposure across
*every* venue, not every crypto venue.
