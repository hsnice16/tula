# Roadmap

The order is deliberate: **every number is computed by deterministic code, and
every view works without the model.** If the risk view is not worth opening on
its own, an agent on top will not save it — so the commands come first and stay
authoritative.

Per-milestone tasks in [`tasks/`](./tasks). Shipped work in [CHANGELOG.md](./CHANGELOG.md).

| # | Theme | Why here |
|---|---|---|
| **1** | ✅ Foundations — schema, secrets boundary, Kraken · [`foundations`](./tasks/foundations) | Prove the loop end to end on one venue before generalizing |
| **2** | ✅ The shell — Ink surface, plain English, prices, net exposure · [`the-shell`](./tasks/the-shell) | The daily driver must be venue-agnostic, or it is five browser tabs in one terminal |
| **3** | ✅ Cross-domain — Hyperliquid, Aave · [`cross-domain`](./tasks/cross-domain) | Three domains at once is the claim; two venues of one kind proves nothing |
| **4** | ◐ Breadth — hand-built venues, wallet tokens, price sources, chain reach, the depth of each venue already read · [`breadth`](./tasks/breadth) | Hand-building the long tail is the treadmill that kills aggregators |
| **5** | ✅ Distribution — install script, attestations, Homebrew, npm · [`distribution`](./tasks/distribution) | The install path is part of the security product, not logistics |
| **6** | ✅ Risk engine — liquidation distance, shocks, what breaks first · [`risk-engine`](./tasks/risk-engine) | The feature people tell friends about |
| **7** | ✅ The open pieces — the gaps left in 2, 3, 4 and 6 · [`open-pieces`](./tasks/open-pieces) | None of it was new scope, and two of the gaps were live in the shipped product |
| **8** | ○ Trust surface — `doctor`, staleness, scope audit · [`trust-surface`](./tasks/trust-surface) | Keys are stored today, so the obligation to prove what we do with them is already incurred |
| **9** | ○ Watch mode and alerts · [`watch-and-alerts`](./tasks/watch-and-alerts) | "Tell me before my health factor breaks 1.3" is why someone opens this daily |
| **10** | ○ Venue reach — the venue handle, user-added venues, MCP, the aggregator · [`venue-reach`](./tasks/venue-reach) | Reach past what we build ourselves, now that 7 has finished what we started |
| **11** | ○ Model neutrality — provider interface, conformance gate · [`model-neutrality`](./tasks/model-neutrality) | A weaker model costs prose, not numbers. What it does cost is a rule only a good model keeps |
| **12** | ◐ Hardening, and the release that stops being a pre-release · [`hardening`](./tasks/hardening) | Read-only, non-custodial, complete |
| **13** | ○ The trade diff, with no way to send it · [trade diff](./tasks/execution/01-trade-diff.md), [policy file](./tasks/execution/02-policy-file.md) | The primitive nobody in trading has, and nothing in it can move money |
| **14** | ○ Execution — signing authority that is never ours · [plan, paper, live](./tasks/execution/04-plan-paper-live.md) | The venue's scoped key, the user's own wallet, or a capped grant. tula holds none of them |
| **15** | ○ Defensive autonomy · [session keys](./tasks/execution/03-session-keys.md) | A defensive action has a right answer. "Trade for me" is gambling with extra steps |
| **16** | ○ Strategies · [the artifact](./tasks/execution/05-strategy-artifact.md) | No-code plus autonomous means the user cannot read what will run |

✅ shipped · ◐ partly done · ○ not started. The `**Status**:`
line in each task file is the record; this column is the summary of it. A record
is only worth the check behind it, so a task marked `done` names the tests
covering its acceptance and `src/tasks.test.ts` fails on one that does not —
[`tasks/README.md`](./tasks/README.md) has the convention.

Two milestones are ◐ — **4** and **12** — and every open piece is named here
rather than left to the reader. Neither holds a bullet marked `**Not met.**`:
that spelling and no other, so one grep over `tasks/` now finds none, and this
paragraph can be checked rather than believed. What is left of each is work
nobody has started rather than work that missed. 4 is the aggregator, which
waits for 10, and Aave V4, which does not — the two are split below. 12 is ◐ the
other way round from every other row: the docs site shipped, and of the
hardening pass two bullets already hold on their own — no panic path leaves the
terminal in raw mode, on both the shell and the one-shot prompt, and every
venue-supplied string is treated as data on every path that renders it — while
the rest of that milestone has not started.

**1**, **2** and **6** closed. 2's last bullet was the reader-facing half of the
injection work: venue text was labelled for the model — every tool result
carries a sidecar naming the paths its outside text sits at — and said nothing
to the reader, who is on the surface that works with no model at all. A name a
venue spelled in text tula could not print is `ALTERED` on every view now,
naming the venue, the bounded name and the `TULA_<CHAIN>_RPC` that chooses the
node that sent it; what the venue actually sent is not shown, because that
string is the one that repaints a line.

1's last bullet accepted a `redact()` helper for the log and error paths; what
shipped instead is the property it would only have approximated — no module
holding a credential may hand one to a log, an error, a file or another process,
and `src/secrets/` has no way out of the process at all, both failing the build
in `scripts/guard.sh`. 6's was a shocked health factor computed as though the
debt stood still, which is a stablecoin borrow and not a same-asset one: the
assumption is checked against the book now and stated to the reader where it
breaks, rather than sitting in a comment on `healthFactorUnder`.

**7** shipped. It closed 3's last gap — the credential store holds an ordered
set, every entry is read, and each row carries the account it came from — and it
added the line that says what tula never asked for: a chain never queried is not
a venue that *failed*, so `INCOMPLETE` stayed quiet and the total was short with
nothing saying so. Availability landed beside it, under 6, which is why 6
closed on one unstated assumption rather than on four connectors summing a free
balance away. Labelling venue text *to the model* was 7's item; saying
so on screen was 2's, and both now hold — `ALTERED` is the fifth thing a view
says about itself.

4's two open pieces are scheduled in different places, and the same rule puts
each where it is: everything uncovered that *can* be liquidated is hand-built,
and the aggregator takes what cannot.

The aggregator is the larger of the two and it waits for **10**. What it would
add is exposure nobody can be liquidated on, and it could not supply a health
factor for it anyway. It completes a total rather than repairing one, which is
the line 7 was drawn on.

**Aave V4 stays in 4**, and is the one piece of it scheduled here. It is live on
Ethereum, it holds real deposits, and it hides a *liquidation* — the connector
declares it unread and `scripts/conformance.live.ts` re-checks against the live
address book that the gap is still real. It was filed as deliberately deferred
on the grounds that V4 is Hubs and Spokes rather than Pools, which is a statement
about effort and not a decision: it is the venue tula already claims to read, one
major version on, and as v3 drains into v4 an Aave position tula cannot see is a
liquidation tula cannot rank. [`breadth/08`](./tasks/breadth/08-aave-v4.md) is
the task, and it is honest about what is unknown — the account model, whether a
health factor is per Hub, whether `getUserAccountData` has an equivalent. The
`NOT READ` line stands until the connector reads V4; that is what tells the user.

The risk engine (6) landed alongside breadth and distribution rather than after
them, and that reordering is why this table stopped naming versions: it used to,
and a plan that moves makes a published number wrong.

8 and 9 come before any of 10 through 16, as 7 did. A gap inside something
shipped outranks new scope — a wrong number and a rule only a good model keeps
are both shipped, in a product that already stores exchange keys. 9 is there
rather than later because a risk tool you have to remember to open is a tool you
forget.

One rule cuts across that order, and it is as much the decision this table
exists to record: **work that is cheap while the product is read-only and a
migration afterwards is pulled forward, whatever milestone it is filed under.**
Two tasks qualify, and they make the same argument in the same words —
[`model-neutrality/01`](./tasks/model-neutrality/01-provider-interface.md), the
provider interface, which execution tooling would otherwise be sitting on top
of, and [`venue-reach/01`](./tasks/venue-reach/01-venue-handle.md), the venue
handle, an optional field nothing reads today and a schema change across every
connector once a trade is built from a position. Neither drags its milestone
with it: the conformance gate, the second provider, user-added venues, MCP and
the aggregator all wait for 8 and 9 as before.

11 is a refactor before it is a feature: the Anthropic client is the shape of
what shipped first, not an argument for what the interface should be. The gate
and the second provider wait for a reason to ship one.
[`hardening/02-first-user`](./tasks/hardening/02-first-user.md) is
the other thing that could reorder this — if the answer to who this is for names
a venue we do not read, 10 moves ahead of 8.

## Where the lines are

Two releases carry a promise rather than a number, and everything above is
ordered around them.

**1.0 is 12.** Read-only, non-custodial, complete, and worth opening without a
model. Nothing left in 8–11 changes that: a second model provider, a venue read
over MCP, and a user-added venue are all still reads.

**2.0 is 14**, because that is where signing authority enters the product and
the read-only promise is retracted by plan. Retracting it is one commit across
the nine surfaces `src/site-claims.test.ts` pins the caveat to, which is what
makes it one commit rather than nine.

**13 sits between them on purpose.** A diff that states a proposed change in
exposure terms — fees, slippage, the resulting move in liquidation distance,
every policy breach listed before the prompt — is the most useful thing in the
execution work and the only part of it that cannot move money. Shipping it
a full release before anything can be sent makes the review surface older than
the ability to act, which is the safety argument made structural instead of
stated. Aave's own agent interface splits `preview_action` from `prepare_action`
for the same reason.

## What is not read yet, and where each piece is

Every connector declares what it never asks its venue for, and `/venues` prints
the list. That declaration exists so a half-read account is never served as a
whole one — it was never meant to be a standing statement about the product, and
a count of it beside every figure was one, so the count came off the view.

The obligation it creates is answered here instead. Thirty areas are declared
across seven venues, and each one names the task that would close it in the
manifest itself: `src/coverage-plan.test.ts` fails the build on a gap whose
plan is not a real task, on one filed under a task already finished, on one
hiding a liquidation filed under the aggregator, and on any plan this table
does not name. Declared-and-unfiled is what that test exists to make
impossible — thirteen of the thirty were in that state when it was written, two
of them mentioned in no file at all.

| What | Where |
|---|---|
| Aave V4 — the Hubs on Ethereum | [`breadth/08`](./tasks/breadth/08-aave-v4.md) |
| The Safety Module, isolation mode, stable-rate debt | [`breadth/09`](./tasks/breadth/09-aave-depth.md) |
| Hyperliquid's spot hold, isolated margin, staking, vaults, sub-accounts, borrow/lend, builder dexes | [`breadth/10`](./tasks/breadth/10-hyperliquid-depth.md) |
| Staking and yield-bearing tokens, NFTs | [`breadth/11`](./tasks/breadth/11-wallet-depth.md) |
| The EVM chains outside the three, HyperEVM, Solana | [`breadth/12`](./tasks/breadth/12-chain-reach.md) |
| Binance's cross-margin liquidation level, COIN-M and Portfolio Margin, earn products, held balances, sub-accounts | [`breadth/13`](./tasks/breadth/13-binance-depth.md) |
| Coinbase's other portfolios and its CFTC-regulated futures | [`breadth/14`](./tasks/breadth/14-coinbase-depth.md) |
| Kraken's account margin level, Kraken Futures, the two free/held splits, drawn credit lines | [`breadth/15`](./tasks/breadth/15-kraken-depth.md) |
| Stripe Treasury and connected accounts under a platform | [`breadth/16`](./tasks/breadth/16-stripe-depth.md) |
| What an LP or vault receipt token is a claim on | [`breadth/01`](./tasks/breadth/01-aggregator-api.md) |

Ordered by venue rather than by size. An earlier draft of this paragraph called
three of them "a decode of bytes already fetched", and reading the code rather
than the declarations showed that claim was worth what such claims usually are.
The bytes are in hand; decoding them changes no figure on any screen, and
retiring a declaration for that would shorten the list without the reader seeing
anything new. What the exercise turned up instead was a gap nobody had declared
— the eMode category Aave liquidates an account against — and it was a wrong
number rather than a missing one, sitting under a health factor Aave did state,
which is why nothing about it looked wrong. It is fixed rather than listed
above; [`breadth/09`](./tasks/breadth/09-aave-depth.md) records what reading it
against the chain turned out to require, including the field that looks like
the answer and is not.

Nothing here is a promise about a date. What it is is the difference between a
gap somebody chose and a gap nobody has looked at, and the two sections at the
bottom of this file hold the ones that were chosen.

## Versions

Milestones are the plan; **versions describe releases**, and one is only chosen
when a release is cut, from what actually went into it. [SemVer](https://semver.org),
pre-1.0:

| Bump | For |
|---|---|
| **patch** | Fixes, security hardening, doc and site corrections. No new surface. |
| **minor** | A new venue, command or capability — and, while `0.x`, anything breaking |
| **major** | `1.0.0` is the stability promise. `2.0.0` is execution. |

A hyphen means pre-release (`0.2.0-alpha.1`). It is the only signal: the binary
derives its label from it and `release.yml` picks `--prerelease` and the npm
dist-tag from it, so there is nothing to keep in step by hand.

The folders under [`tasks/`](./tasks) are named for their milestone;
[`tasks/README.md`](./tasks/README.md) says why none is named for a version.
Milestones 13–16 draw on [`tasks/execution/`](./tasks/execution), which was
written when execution was one release.

## What v1 is not

- **Not an execution venue.** No orders, no funds moved, no code path that could.
  Placing trades will come later; moving funds will not.
- **Not custodial.** Public addresses on-chain, query-only keys for exchanges.
  tula never generates a private key and never asks for a seed phrase. The one
  it stores is Coinbase's CDP API key, which signs read requests only.
- **Not a place the model does arithmetic.** It queries the risk engine and
  narrates what comes back, never touching a venue API or the secret store.
- **Not dependent on a model.** Every view has a command behind it. Without a key
  you lose plain English and nothing else.

## What custody means after 1.0

Execution needs something to sign, and the answer is never a key of ours. Stated
here because it is the one thing in 14–15 that cannot be revisited later without
withdrawing the promise the rest of this file makes.

| Authority lives with | tula does | For |
|---|---|---|
| The venue — a trade-scoped API key | Submits an order with a key proven unable to withdraw | Kraken, Binance, Coinbase, Hyperliquid |
| The user — a hardware wallet or a phone | Builds the transaction, hands it out, takes back a signature | Any human-approved on-chain action |
| A short-lived on-chain grant | Holds a throwaway signer capped by contract, function and expiry | Autonomous actions only |

The seed phrase and the root key never enter the product. `KeyScope` already
carries this: `canTrade === true` becomes a requirement instead of a refusal,
and the withdraw refusal stands unchanged.

## What does not change

**No compromise on user experience and security.** Every milestone above is held
to it, execution included — the guardrails in 14–15 are the same promise as the
read-only refusals in 1, made about a larger surface. `AGENTS.md` states the rule
and the conventions that carry it. A version ships when both are true of it, and
the plan moves rather than the standard.

## Deliberately deferred

Every entry here is a decision not to build something, never a note on how much
work it would be — the two read alike in a list and are opposite things, and
Aave V4 sat here on an effort statement until somebody read it. The test each
one passes: **if this became trivial tomorrow, the project would still refuse
it.** What fails that test is not a decision and is in the section below.

- **Reading half a linked balance.** A HyperEVM holding is a HyperCore spot
  balance and an EVM ERC-20 scaled against each other per token, and a figure
  from one leg alone is not the holding. That refusal is what belongs here, and
  it survives the test above: however cheap one leg became, publishing it would
  still be refused. The chain itself does not — reading *both* legs is ordinary
  work, and it is [`breadth/12`](./tasks/breadth/12-chain-reach.md). This entry
  sat here naming the chain rather than the half-reading, which is how a
  correctness rule turned into a permanent absence.
- **Hand-built long-tail protocols** (Pendle, Ethena, Lido, Curve) — the tail
  that hides a *value*. One aggregator covers hundreds; hand-building covers
  four and never stops. Nothing that can liquidate you is in this bullet,
  whatever its size: the rule 4 is split on sends that to the hand-built side,
  and Morpho sat here against it until somebody read the two side by side.
- **A plugin system for user-added venues.** Arbitrary local code in a process
  that holds exchange keys, to save writing a config file.
- **A general-purpose manifest language.** A user-added exchange declares one of a
  closed set of authentication schemes. Anything expressive enough to cover every
  exchange is expressive enough that nobody can review one.
- **Hosted reads where we already read the chain.** A remote server sees the
  address it is asked about. Additive for what we cannot get ourselves, never a
  replacement for what we can.
- **Tax and P&L reporting** — a different product with a different data model.

## Not refused, only unscheduled

An entry here fails the test the section above passes: if it became trivial
tomorrow this project would do it. So it is not a decision, and filing it as one
is how a cost turns into a position nobody re-examines. It sits here because no
milestone holds it yet, and it leaves by being given one — or by somebody
finding the principle that would move it up instead.

- **Morpho, Compound and Spark.** The lenders left uncovered that state a health
  factor, which by the same rule are hand-built and not the aggregator's. Aave
  is the venue tula already claims to read, so its own depth has milestones —
  [`breadth/08`](./tasks/breadth/08-aave-v4.md) and
  [`breadth/09`](./tasks/breadth/09-aave-depth.md) — and these do not yet.
- **musl Linux, and a native Windows build.** Both are absent entries in the
  release matrix rather than positions: Bun compiles `bun-linux-x64-musl` and
  `bun-windows-x64`, and `scripts/release-build.sh` publishes four targets that
  are neither. Windows needs an install path as well as a binary, which is the
  larger half of it. `install.sh` detects musl and says so rather than failing
  at exec time, and the README sends Windows to WSL; both are honest about the
  gap and neither is an argument for keeping it.
