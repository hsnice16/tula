# Roadmap

The order is deliberate: **every number is computed by deterministic code, and
every view works without the model.** If the risk view is not worth opening on
its own, an agent on top will not save it — so the commands come first and stay
authoritative.

Per-version tasks in [`tasks/`](./tasks). Shipped work in [CHANGELOG.md](./CHANGELOG.md).

| Version | Theme | Why here |
|---|---|---|
| **0.1.0** | Foundations — schema, secrets boundary, Kraken | Prove the loop end to end on one venue before generalizing |
| **0.2.0** | The shell — Ink surface, plain English, prices, net exposure | The daily driver must be venue-agnostic, or it is five browser tabs in one terminal |
| **0.3.0** | Cross-domain — Hyperliquid, Aave | Three domains at once is the claim; two venues of one kind proves nothing |
| **0.4.0** | Risk engine — liquidation distance, shocks, what breaks first | The feature people tell friends about |
| **0.5.0** | Trust surface — `doctor`, staleness, scope audit | Asking for keys obliges us to prove what we do with them |
| **0.6.0** | Breadth — aggregator API, the hand-built venues, wallet tokens, price sources | Hand-building the long tail is the treadmill that kills aggregators |
| **0.7.0** | Watch mode and alerts | "Tell me before my health factor breaks 1.3" is why someone opens this daily |
| **0.8.0** | Distribution — install script, attestations, Homebrew, npm | The install path is part of the security product, not logistics |
| **1.0.0** | Hardening and public release | Read-only, non-custodial, complete |
| **2.0.0** | Execution — trade diff, policy file, session keys | Guardrails enforced by a contract, not by app config |

## What v1 is not

- **Not an execution venue.** No orders, no funds moved, no code path that could.
- **Not custodial.** Public addresses on-chain, query-only keys for exchanges.
  tula never generates or stores a private key or seed phrase.
- **Not a place the model does arithmetic.** It queries the risk engine and
  narrates what comes back, never touching a venue API or the secret store.
- **Not dependent on a model.** Every view has a command behind it. Without a key
  you lose plain English and nothing else.

## Deliberately deferred

- **Solana** — a different RPC and token model; effectively a second codebase.
- **Hand-built long-tail protocols** (Pendle, Ethena, Lido, Morpho, Curve). One
  aggregator covers hundreds; hand-building covers five and never stops.
- **Tax and P&L reporting** — a different product with a different data model.
- **musl Linux.** Builds link against glibc; the installer detects musl and says
  so rather than failing at exec time.
