# 7 · The open pieces

Nothing here is new scope: every item is a gap inside something that already
shipped. Closing it finishes milestones 2, 3 and 6, and leaves 4 holding only the
aggregator.

They belong together because they are one gap wearing four sets of clothes — **the
book does not yet tell the truth about itself.**

- **What is actually yours.** Four connectors fetch what is free to move and sum
  it away, so an open order, a pending payout and pledged collateral all read as
  spendable.
- **What tula actually read.** A chain never queried is not a venue that failed,
  so `INCOMPLETE` stays silent and the total is short with nothing saying so.
- **Which text is actually ours.** Venue strings reach the model as ordinary
  values, and what marks them as data is a sentence in the system prompt.
- **How much of you it reads.** One address per venue, one chain, eight venues —
  each a limit nobody is told about.

## Tasks

- [01 · Scope disclosure](01-scope-disclosure.md) — planned
- [02 · A credential store that holds a set](02-credential-store-set.md) — planned
- [Availability](../risk-engine/04-availability.md) — planned
- [Prompt injection defence](../the-shell/09-injection-defense.md) — in_progress
- [Multiple addresses per venue](../cross-domain/03-watched-addresses.md) — needs 02
- [Chain coverage](../breadth/03-chain-coverage.md) — planned

## Order

01 first: it is the cheapest, and it makes every limit below it honest while the
rest are still being built. Then availability, which is the one where a shipped
view currently misleads. Then injection labelling, which is small and unblocks
the conformance gate in 11. Then 02, which unblocks multiple addresses. Chains
and the aggregator last, and the aggregator is the item most likely to slip —
choosing between Zerion, Zapper, DeBank Cloud and Alchemy Portfolio is a decision
about cost and terms, not an implementation detail.

## Done means

Each task names the test file and the cases it has to carry. A case here states
the failure it prevents rather than the mechanism, because the name is what a
reader sees when it breaks at 2am — the same reason `src/core/exposure.test.ts`
says *notional is null without a price, never zero* rather than *returns null*.

Nothing is stubbed ahead of the work: a placeholder test is a reachable stub, and
`bun run check` gates every commit, so a failing test would block the tree until
the feature lands.

## Not here

The venue handle, user-added venues and the MCP adapter are milestone 10. Those
are reach beyond what we build; this is finishing what we started.
