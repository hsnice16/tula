# 04 · Availability

**Status**: planned · the inputs exist, nothing reads them

## Goal

One question — **how much of this can you actually move** — answered wherever the
venue makes it answerable, and admitted where it does not.

## What the user sees today

Ten ETH supplied to Aave against USDC debt reads as **10 ETH**. Correct as
exposure — the price move is still theirs — but it reads as holdings, and the
decision it corrupts is the ordinary one: *I have 10 ETH, I do not need to top
up.* That ETH is securing a loan. Acting on it fails, or liquidates what it was
securing.

The same sentence is true of a Binance balance sitting in an open order, a
Coinbase hold, a Kraken `.S` balance mid-unbond, and a Stripe payout that has not
settled. Different causes, one mistake.

## Where the answer already is

| Venue | What it reports | What tula does |
|---|---|---|
| Binance | `free` and `locked` | sums them into one `spot` position |
| Coinbase | `available_balance` and `hold` | sums them into one `spot` position |
| Hyperliquid | `withdrawable`, `totalMarginUsed` | reads `withdrawable`, already names it `free` |
| Circle, Stripe | unsettled and pending | `kind: 'pending'`, which `position.ts` defines as *not yet available to move* |
| Kraken | `/0/private/Balance`, a total | nothing to split it with |
| Aave | collateral securing debt | sets `encumbers`, read by nothing |
| Wallet | — | nothing is pledged; all of it is free |

Four of the seven already fetch the split and discard it. `encumbers` is one
mechanism of several, not the definition — which is why this task is availability
rather than encumbrance.

## Acceptance

- Every asset reports how much is free to move, and how much is not.
- **Free is `null` where it cannot be proven, never the total.** Kraken's balance
  endpoint reports no hold, so either the connector moves to one that does or
  Kraken's free amount is unknown. Reporting the total as free is the confident
  wrong answer `KeyScope`'s tri-state exists to refuse, and it is worse than
  today: nobody currently believes tula answers this.
- **What is unavailable names why**, because the reason is the action. Securing a
  debt means repay it; staked means wait out the unbond; pending means wait for
  settlement; locked means cancel the order. A single "encumbered" bucket tells
  a reader they cannot act and not what to do — the dead end rule 7 forbids.
- **Exposure is unchanged.** A pledged asset moves with its price exactly as an
  unpledged one does, and the free figure must never reach `delta`. This is the
  one that would corrupt every exposure figure silently.
- Free plus unavailable is the whole holding wherever both are known, so the
  split loses nothing.
- **Partial, not all-or-nothing.** Ten ETH with four pledged is four unavailable
  and six free, not ten of either.
- The same asset pledged at two venues subtracts both. Aave collateral and
  Hyperliquid margin in ETH are two claims on one holding.
- **Free never goes quietly negative.** A holding claimed beyond what it holds —
  the state a health factor under 1 describes — says so rather than clamping to
  zero.
- A debt whose collateral failed to load reports neither figure for it, rather
  than free collateral it could not see. An `encumbers` id naming a position not
  in the book is a gap, not a licence to call the holding free.
- Availability is venue-local. Nothing at one venue claims anything at another.
- A holding with no price still splits: the split is a quantity, and `notional`
  being null says nothing about what is pledged.
- Shown only where there is something to say. An asset entirely free gains no
  column, or the answer costs more attention than it returns.
- Rendered by `src/core/format.ts` like any other quantity. A second `toFixed`
  is a second answer to the same question.
- Covered in `src/core/availability.test.ts`, with the venue splits in
  `binance.test.ts`, `coinbase.test.ts` and `hyperliquid.test.ts`.

## The decision, settled

**A function in `src/core`, not fields on `NetExposure`.**

`NetExposure` answers price sensitivity. Availability is a different question, and
the two were conflated once already — `Net value` became `Net notional` because
"value" counted a leveraged perp's whole position and overstated net worth by
exactly the leverage. A `free` field inside a record about price sensitivity
invites that again.

It is also where the graph gets inverted exactly once. `encumbers` is set on the
*debt* leg pointing at collateral, so a collateral position does not know it is
pledged; answering for it means scanning every position for anyone pointing at
it. Three call sites doing that independently is three answers.

Both are pure functions over the same `Position[]`, so there is no second
snapshot to disagree with. Surfaces still show one row: `src/agent/tools.ts`
builds its own rows and can carry both without `NetExposure` carrying either.

## Notes

Binance and Coinbase are the cheapest work here: the data is already fetched, and
summing it away is a deliberate line in each connector. Kraken is the opposite —
the honest answer there is `unknown` until the connector reads an endpoint that
reports the hold, and `unknown` is a shipped answer, not a gap.
