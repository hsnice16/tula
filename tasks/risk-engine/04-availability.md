# 04 · Availability

**Status**: done
**Covered by**: `src/core/availability.test.ts`, `src/cli/commands.test.ts`,
`src/agent/tools.test.ts`, `src/consistency.test.ts`, `src/connectors/binance.test.ts`,
`src/connectors/coinbase.test.ts`, `src/connectors/kraken.test.ts`,
`src/connectors/hyperliquid.test.ts`

## Goal

One question — **how much of this can you actually move** — answered wherever the
venue makes it answerable, and admitted where it does not.

## What the user saw

Ten ETH supplied to Aave against USDC debt read as **10 ETH**. Correct as
exposure — the price move is still theirs — but it read as holdings, and the
decision it corrupts is the ordinary one: *I have 10 ETH, I do not need to top
up.* That ETH is securing a loan. Acting on it fails, or liquidates what it was
securing.

The same sentence was true of a Binance balance sitting in an open order, a
Coinbase hold, a Kraken `.S` balance mid-unbond, and a Stripe payout that has not
settled. Different causes, one mistake.

## Where the answer already was

| Venue | What it reports | What tula did with it |
|---|---|---|
| Binance | `free` and `locked` | summed them into one `spot` position |
| Coinbase | `available_balance` and `hold` | summed them into one `spot` position |
| Hyperliquid | `totalRawUsd`, `withdrawable`, `totalMarginUsed` | read the raw balance; what of it was free went unsaid |
| Stripe | unsettled and pending | `kind: 'pending'`, which `position.ts` defines as *not yet available to move* |
| Kraken | `/0/private/Balance`, a total | nothing to split it with |
| Aave | collateral securing debt | set `encumbers`, read by nothing |
| Wallet | — | nothing is pledged; all of it is free |

Four of them already fetched the split and discarded it. `encumbers` is one
mechanism of several, not the definition — which is why this task is availability
rather than encumbrance.

## Acceptance

- Every asset reports how much is free to move, and how much is not.
- **Free is `null` where it cannot be proven, never the total.** Reporting the
  total as free is the confident wrong answer `KeyScope`'s tri-state exists to
  refuse. Kraken was the case that set the rule: `/0/private/Balance` reports no
  hold at all, so the connector moved to `BalanceEx`, which reports one — and
  still withholds the figure in the two cases that endpoint cannot answer, an
  account with a margin position open and an account with more than one wallet.
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

Binance and Coinbase were the cheapest work here: the data was already fetched,
and summing it away was a deliberate line in each connector. Kraken was the
opposite — the honest answer was `unknown` until the connector read an endpoint
that reports the hold, and `unknown` is a shipped answer, not a gap.

## What shipped

`availability(positions, facts)` in `src/core/availability.ts`, one entry per
holding, with the `encumbers` graph inverted in that one place. Two calls in it
are worth stating, because neither is in the acceptance above:

- **How much of a pledged Aave leg is free is read off the health factor**, as
  `quantity × (1 − 1/HF)` — the fraction of every collateral leg the market
  releases before it reaches 1.00. Prices and liquidation thresholds cancel out
  of that ratio, which is what lets the split stay a quantity for an asset
  nobody priced, and with one collateral asset it is exactly what the protocol
  will let go of. It is labelled as the lender's limit rather than as advice:
  1.00 is the level it liquidates at, and `breaks` answers what happens there.
  **Not confirmed by the maintainer** — flagged rather than assumed.
- **Which venues cannot state a free figure is read off `coverage`**, from the
  gap each connector declares as `hides: 'availability'`, rather than a second
  list beside it. It withholds the free figure on a venue's plain balance rows;
  a hold or a pledge tula can actually see is still stated there. Kraken and
  Hyperliquid are the two that reach it today, and Stripe the third — a Stripe
  balance is "available" in Stripe's sense and not payable out now, which is the
  question this column asks.

A perp carries no free figure at all: it is exposure rather than a quantity of
anything sitting anywhere, and a long reported as free would read as cash the
size of the whole position.

A venue watching several addresses is answered per address: a debt at one wallet
claims only that wallet's collateral, and an `encumbers` id nobody could resolve
blanks that wallet's figures alone. Read off `Position.account`, never out of an
id — the ids are namespaced per account, and parsing one for meaning is the
coupling `03-watched-addresses` moved the account into a field to avoid.
