# 7 · The open pieces

Shipped. Nothing here was new scope: every item was a gap inside something that
had already shipped. Closing it finished milestone 3, left 4 holding the
aggregator and one dead end, and left 6 holding one unstated assumption.

They belonged together because they were one gap wearing four sets of clothes —
**the book did not tell the truth about itself.** What each of them was, and what
answers it now:

- **What is actually yours.** Four connectors fetched what was free to move and
  summed it away, so an open order, a pending payout and pledged collateral all
  read as spendable. `src/core/availability.ts`, and the **FREE** and
  **UNAVAILABLE** columns it draws.
- **What tula actually read.** A chain never queried is not a venue that failed,
  so `INCOMPLETE` stayed silent and the total was short with nothing saying so.
  `src/core/coverage.ts`, and what `/venues` reads off it.
- **Which text is actually ours.** Venue strings reached the model as ordinary
  values, and what marked them as data was a sentence in the system prompt. Every
  tool result now names the paths that text sits at, derived from the payload.
- **How much of you it reads.** Three chains and no more, and one or two
  endpoints of each venue connected — each a limit nobody was told about. Each
  connector declares its own, and each declaration is held open by a test.

## Tasks

- [01 · Scope disclosure](01-scope-disclosure.md) — done
- [02 · A credential store that holds a set](02-credential-store-set.md) — done
- [Availability](../risk-engine/04-availability.md) — done
- [Prompt injection defence](../the-shell/09-injection-defense.md) — done
- [Multiple addresses per venue](../cross-domain/03-watched-addresses.md) — done
- [Chain coverage](../breadth/03-chain-coverage.md) — done

## What is left, and where it lives now

The reader-facing half of the injection work was this section's one open item and
has since shipped as `ALTERED`: a venue that spelled an asset in characters this
build could not draw is named on screen, with what was done and the bounded name.
It was milestone 2's to close, not this one's.

The aggregator was never this milestone's — it completes a total rather than
repairing one, and it waits for 10.

## Done means

Each task names the test file and the cases it has to carry. A case here states
the failure it prevents rather than the mechanism, because the name is what a
reader sees when it breaks at 2am — the same reason `src/core/exposure.test.ts`
says *notional is null without a price, never zero* rather than *returns null*.

Nothing was stubbed ahead of the work: a placeholder test is a reachable stub, and
`bun run check` gates every commit, so a failing test would have blocked the tree
until the feature landed.

## Not here

The venue handle, user-added venues and the MCP adapter are milestone 10. Those
are reach beyond what we build; this is finishing what we started.
