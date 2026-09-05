# Roadmap

The order is deliberate: **every number is computed by deterministic code, and
every view works without the model.** If the risk view is not worth opening on
its own, an agent on top will not save it — so the commands come first and stay
authoritative.

Per-version tasks in [`tasks/`](./tasks). Shipped work in [CHANGELOG.md](./CHANGELOG.md).

| # | Theme | Why here |
|---|---|---|
| **1** | Foundations — schema, secrets boundary, Kraken | Prove the loop end to end on one venue before generalizing |
| **2** | The shell — Ink surface, plain English, prices, net exposure | The daily driver must be venue-agnostic, or it is five browser tabs in one terminal |
| **3** | Cross-domain — Hyperliquid, Aave | Three domains at once is the claim; two venues of one kind proves nothing |
| **4** | Breadth — the hand-built venues, wallet tokens, price sources, aggregator API | Hand-building the long tail is the treadmill that kills aggregators |
| **5** | Distribution — install script, attestations, Homebrew, npm | The install path is part of the security product, not logistics |
| **6** | Risk engine — liquidation distance, shocks, what breaks first | The feature people tell friends about |
| **7** | Trust surface — `doctor`, staleness, scope audit | Asking for keys obliges us to prove what we do with them |
| **8** | Watch mode and alerts | "Tell me before my health factor breaks 1.3" is why someone opens this daily |
| **9** | Hardening, and the release that stops being a pre-release | Read-only, non-custodial, complete |
| **10** | Execution — trade diff, policy file, session keys | Guardrails enforced by a contract, not by app config |

1–6 are substantially in the tree, and the `**Status**:` lines under
[`tasks/`](./tasks) are the record of what is not — the aggregator API and
chain coverage beyond Ethereum are the open pieces of 4, encumbrance of 6 and
injection defence of 2. The risk engine (6)
landed alongside breadth and distribution rather than after them, and that
reordering is why this table stopped naming versions: it used to, and a plan that
moves makes a published number wrong. Of 7 onward, only the docs site (part of 9)
has shipped.

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

The folders under [`tasks/`](./tasks) are named for the version they were planned
under. Those names are history, not a promise about where the work ships.

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

## What does not change

**No compromise on user experience and security.** Every milestone below is held
to it, execution included — the guardrails in 10 are the same promise as the
read-only refusals in 1, made about a larger surface. `AGENTS.md` states the rule
and the conventions that carry it. A version ships when both are true of it, and
the plan moves rather than the standard.

## Deliberately deferred

- **Solana** — a different RPC and token model; effectively a second codebase.
- **Hand-built long-tail protocols** (Pendle, Ethena, Lido, Morpho, Curve). One
  aggregator covers hundreds; hand-building covers five and never stops.
- **Tax and P&L reporting** — a different product with a different data model.
- **musl Linux.** Builds link against glibc; the installer detects musl and says
  so rather than failing at exec time.
