# 13 · Binance depth

**Status**: planned

## Goal

Read the rest of what a Binance account holds. Binance's `NOT READ` line is the
longest tula prints, because Binance is the venue that keeps money in the most
places at once — spot, margin, a funding wallet, the earn products, and any
number of sub-accounts under one login.

[`02`](./02-binance-connector.md) landed spot and margin and declared five gaps.
Three are calls nobody makes; one is a number Binance may not state; one cannot
be closed by writing code at all.

## Acceptance

- **The margin level a cross account is liquidated at.** `marginLevel` is on the
  cross-margin response the connector already reads and discards; what is
  missing is the bar it is measured against. Binance publishes 1.1 for Cross
  Margin Classic and says its tiered accounts differ without publishing theirs.
  So the question this task answers first is whether a read-only key can reach
  the per-account summary that states that account's own force-liquidation bar —
  the margin API has one, and whether it answers a reading key is proven against
  a live key in `scripts/conformance.live.ts`, not assumed. If it answers, the
  cross legs carry a distance the venue itself stated, and their empty
  `liquidation` fills. If nothing states it per account, the gap stays: a bar
  tula picks and measures against is a number Binance never said, which is the
  objection [`08`](./08-aave-v4.md) already makes to a health factor tula
  derives.
- **COIN-M futures and Portfolio Margin.** The blocker is tula's rule, not
  Binance's data: both need a key with `enableFutures`, Binance grants that as
  futures *trading*, so `verifyScope` reports `canTrade` and `isOverScoped`
  refuses the key before any call is made. USD-M is already written under that
  same refusal and kept because the refusal is the thing that could change — a
  second unreachable read proves nothing the first does not. What closes this is
  Binance splitting the permission, a scope that reads futures without granting
  trade. Until it does, the entry stays and says why, and the page to watch is
  the key-restrictions page rather than the endpoint list.
- **The funding wallet, Simple Earn, ETH and SOL staking, Dual Investment and
  loans** — one signed read each, none refused by our rule, which is what makes
  this the largest closable gap on the venue. Two things to settle rather than
  discover late: a loan is debt and lands as `debt`, never netted against the
  collateral beside it; and a locked earn or staking position is not spendable,
  so it belongs to the availability column
  [`risk-engine/04`](../risk-engine/04-availability.md) draws.
- **Frozen, withdrawing and IPO balances** — `getUserAsset` carries the three
  slices `/api/v3/account` omits. Settle whether they sit inside the `locked`
  figure already read or beside it before drawing a row: added on top of a
  `locked` that already contains them, the book inflates silently — worse than
  the gap, by the rule [`11`](./11-wallet-depth.md) states for the same trap.
- **Sub-account balances.** A master key lists them, and each is an account
  under one venue — the shape
  [`cross-domain/03`](../cross-domain/03-watched-addresses.md) already built:
  `Position.account` per entry, one Binance in `/` and in the menu rather than
  one per sub-account. The key tula holds may not be the master, so a refusal
  there is an account that is not one, read the way `NO_PERMISSION` already
  reads a key that cannot see futures — not a venue that failed.
- Each gap closed removes its `doesNotRead` entry and the test in
  `binance.test.ts` holding it open, in the same change.

## Notes

The two gaps that hide a liquidation head the list, but one of them is not
workable and the other may end in a declaration that stays. What is left is
value, which is why this sits behind [`12`](./12-chain-reach.md) and
[`09`](./09-aave-depth.md) — both of which shorten a liquidation gap for less.
