# Roadmap

The order is deliberate: **every number is computed by deterministic code, and
every view works without the model.** If the risk view is not worth opening on
its own, an agent on top will not save it — so the commands come first and stay
authoritative.

Per-milestone tasks in [`tasks/`](./tasks). Shipped work in [CHANGELOG.md](./CHANGELOG.md).

| # | Theme | Why here |
|---|---|---|
| **1** | ✅ Foundations — schema, secrets boundary, Kraken · [`foundations`](./tasks/foundations) | Prove the loop end to end on one venue before generalizing |
| **2** | ◐ The shell — Ink surface, plain English, prices, net exposure · [`the-shell`](./tasks/the-shell) | The daily driver must be venue-agnostic, or it is five browser tabs in one terminal |
| **3** | ◐ Cross-domain — Hyperliquid, Aave · [`cross-domain`](./tasks/cross-domain) | Three domains at once is the claim; two venues of one kind proves nothing |
| **4** | ◐ Breadth — hand-built venues, wallet tokens, price sources, aggregator · [`breadth`](./tasks/breadth) | Hand-building the long tail is the treadmill that kills aggregators |
| **5** | ✅ Distribution — install script, attestations, Homebrew, npm · [`distribution`](./tasks/distribution) | The install path is part of the security product, not logistics |
| **6** | ◐ Risk engine — liquidation distance, shocks, what breaks first · [`risk-engine`](./tasks/risk-engine) | The feature people tell friends about |
| **7** | ○ The open pieces — the gaps left in 2, 3, 4 and 6 · [`open-pieces`](./tasks/open-pieces) | None of it is new scope, and two of the gaps are live at v0.1.2 |
| **8** | ○ Trust surface — `doctor`, staleness, scope audit · [`trust-surface`](./tasks/trust-surface) | Keys are stored today, so the obligation to prove what we do with them is already incurred |
| **9** | ○ Watch mode and alerts · [`watch-and-alerts`](./tasks/watch-and-alerts) | "Tell me before my health factor breaks 1.3" is why someone opens this daily |
| **10** | ○ Venue reach — the venue handle, user-added venues, MCP, the aggregator · [`venue-reach`](./tasks/venue-reach) | Reach past what we build ourselves, once 7 has finished what we started |
| **11** | ○ Model neutrality — provider interface, conformance gate · [`model-neutrality`](./tasks/model-neutrality) | A weaker model costs prose, not numbers. What it does cost is a rule only a good model keeps |
| **12** | ◐ Hardening, and the release that stops being a pre-release · [`hardening`](./tasks/hardening) | Read-only, non-custodial, complete |
| **13** | ○ The trade diff, with no way to send it · [trade diff](./tasks/execution/01-trade-diff.md), [policy file](./tasks/execution/02-policy-file.md) | The primitive nobody in trading has, and nothing in it can move money |
| **14** | ○ Execution — signing authority that is never ours · [plan, paper, live](./tasks/execution/04-plan-paper-live.md) | The venue's scoped key, the user's own wallet, or a capped grant. tula holds none of them |
| **15** | ○ Defensive autonomy · [session keys](./tasks/execution/03-session-keys.md) | A defensive action has a right answer. "Trade for me" is gambling with extra steps |
| **16** | ○ Strategies · [the artifact](./tasks/execution/05-strategy-artifact.md) | No-code plus autonomous means the user cannot read what will run |

✅ shipped · ◐ partly done · ○ not started. The `**Status**:`
line in each task file is the record; this column is the summary of it.

Five milestones are ◐. In four of them the work shipped with a gap, and every
open piece is named rather than left to the reader. **2** is prompt injection —
venue text is bounded but not labelled, so what marks it as data is a rule in the
system prompt. **3** is multiple addresses per venue, which one line in the
credential store prevents. **4** is the aggregator API and chain coverage past
Ethereum. **6** is availability — four connectors already fetch what is free and
sum it away, so a balance in an open order, a pending payout and collateral
securing a debt all read as spendable. **12** is ◐ the other way round: the docs
site shipped, and nothing else in that milestone has started.

**7** closes 2, 3 and 6 outright, and the chain half of 4, alongside the line
that says what tula never read: a chain never queried is not a venue that
*failed*, so `INCOMPLETE` stays quiet and the total is short with nothing saying
so. That is what makes 7 one release rather than a list — most of it is the same
defect, which is a book that does not say what it left out.

The aggregator is 4's remaining half and waits for **10**. What it would add is
exposure nobody can be liquidated on: everything uncovered that *can* be
liquidated is hand-built by the policy below, and an aggregator could not supply
a health factor for it anyway. It completes a total rather than repairing one,
which is the line 7 is drawn on.

The risk engine (6) landed alongside breadth and distribution rather than after
them, and that reordering is why this table stopped naming versions: it used to,
and a plan that moves makes a published number wrong.

7 through 9 come before any of 10 through 16, and that is the ordering decision
this table exists to record. A gap inside something shipped outranks new scope —
a wrong number and a rule only a good model keeps are both live at v0.1.2, in a
product that already stores exchange keys. 9 is there rather than later because
a risk tool you have to remember to open is a tool you forget.

11 is a refactor before it is a feature: the Anthropic client is the shape of
what shipped first, not an argument for what the interface should be. Its first
task is cheap now and expensive once execution tooling sits on top, so that one
is worth pulling forward on its own; the gate and the second provider wait for a
reason to ship one. [`hardening/02-first-user`](./tasks/hardening/02-first-user.md) is
the other thing that could reorder this — if the answer to who this is for names
a venue we do not read, 10 moves ahead of 8.

## Where the lines are

Two releases carry a promise rather than a number, and everything above is
ordered around them.

**1.0 is 12.** Read-only, non-custodial, complete, and worth opening without a
model. Nothing in 7–11 changes that: a second model provider, a venue read over
MCP, and a user-added venue are all still reads.

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

- **Solana** — a different RPC and token model; effectively a second codebase.
- **Hand-built long-tail protocols** (Pendle, Ethena, Lido, Morpho, Curve). One
  aggregator covers hundreds; hand-building covers five and never stops.
- **A plugin system for user-added venues.** Arbitrary local code in a process
  that holds exchange keys, to save writing a config file.
- **A general-purpose manifest language.** A user-added exchange declares one of a
  closed set of authentication schemes. Anything expressive enough to cover every
  exchange is expressive enough that nobody can review one.
- **Hosted reads where we already read the chain.** A remote server sees the
  address it is asked about. Additive for what we cannot get ourselves, never a
  replacement for what we can.
- **Tax and P&L reporting** — a different product with a different data model.
- **musl Linux.** Builds link against glibc; the installer detects musl and says
  so rather than failing at exec time.
