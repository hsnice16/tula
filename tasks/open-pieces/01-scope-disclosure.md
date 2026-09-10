# 01 · Scope disclosure

**Status**: done
**Covered by**: `src/core/coverage.test.ts`, `src/cli/commands.test.ts`,
`src/agent/tools.test.ts`, `src/consistency.test.ts`

## Goal

Say what the book does not cover, in the place the book is read.

## Acceptance

- One line with the view, naming what was never asked: the chains not read, one
  address per venue, and the parts of a connected venue nothing reads.
- Derived from what is registered, never written by hand. A sentence maintained
  beside the code it describes is the defect `src/site-claims.test.ts` exists to
  catch, and this one would go stale on the release that fixed it.
- **A connected venue can still be half read, and that is the category most
  likely to mislead**: a venue that answered is taken as complete, so the gap
  produces no `INCOMPLETE` and nothing else marks it. Aave V4 beside the v3
  markets, Binance's funding wallet and earn products, Coinbase's other
  portfolios, Kraken Futures, Hyperliquid's vaults and borrow/lend book, Stripe
  Treasury — the connectors call a handful of endpoints each and the rest of the
  account is unread. Unlike the chains, this is not derivable from the registry:
  a connector has to declare what it covers, or the bullet above it is prose
  again. Kraken's margin positions and its wallets past the default one, Binance's
  margin books and Coinbase's perpetuals were on this list and are read now,
  which is the direction the declaration has to be able to move in.
- **The line does not name a venue with no connector at all.** That list is
  unbounded, identical for every reader and actionable by none of them, so it
  becomes wallpaper — and a line read as wallpaper takes the parts that *are*
  about this account down with it. `README.md` says which venues exist.
- **Not connected is a decision, not a gap.** Naming a venue the user chose not
  to connect, every time they look, is nagging dressed as honesty.
- **A connected venue holding nothing is covered, not uncovered.** An empty book
  and an unread one are the two states this line exists to keep apart.
- Distinct from `INCOMPLETE`, in wording and in cause: that one means a venue
  failed, this one means a venue was never asked. A run that has both says both,
  and a reader must not have to work out which they are looking at.
- It shrinks as coverage grows and disappears when nothing is uncovered.
- Stable between refreshes. A line that changes wording while the coverage has
  not is noise the reader learns to skip.
- Wraps or elides at the narrowest width the shell supports, since the list of
  what is unread grows with every chain that is not yet added.
- The agent's tool results carry the same fact, including the filtered ones —
  a `get_positions` narrowed to one venue must not read as the whole book.
- It sits with the freshness line as a property of the view. Not a warning, not a
  modal, not something to dismiss.
- Covered in `src/core/coverage.test.ts` for the derivation,
  `src/cli/commands.test.ts` for the line — `commands.ts` builds it and
  `shell.ts` only dispatches, so that is where a change to the wording breaks a
  test — and `src/agent/tools.test.ts` for the tool result, including the case
  where a venue added to the registry changes the line with no prose edited.

## Notes

`src/cli/commands.ts` prints `INCOMPLETE — N venue(s) failed. This is not your
full exposure.` A chain tula never queried is not a failure and produces no line
at all, so the one number tula exists to give is understated and nothing says so.
That is the failure the conventions call the worst available — a partial
portfolio served as complete.

Cheap, and it does not wait for 10. Someone whose Base wallet is unread is
under-counted today; this is the difference between a limit they were told about
and one they find out from a liquidation.

## What shipped

`Never asked for. These venues answered about the rest, and nothing failed:` —
every area under the venue it belongs to, opening with what the gap costs the
reader rather than with the endpoint that goes unread.

It is built by `disclosure()` and `notReadDetail()` in `src/core/coverage.ts`
out of each connector's own `coverage.doesNotRead`, so it shrinks when a
connector starts reading something and disappears when the last gap closes.

**Where it is read, and why not everywhere.** It shipped as one line beside the
freshness of every view and on every tool result, and that was wrong. Coverage
does not resolve the way a failure does — a read-only tool has unbounded
uncovered surface — so a count printed beside every figure never reaches zero,
and the block it shared with `INCOMPLETE` stopped being read. `src/core/coverage.ts`
already stated that rule about venues with no connector at all; this is the same
test applied to the connectors we ship. So:

- **`/venues` and `/<venue> status` carry the whole of it**, and
  `get_venue_status.never_asked_for` hands the model the same list. Nothing else
  volunteers it, on either surface — a caveat the model offers over a table
  carrying none is one book described two ways.
- **`breaks` and `shock` are the exception**, and it is the rule rather than a
  hole in it: they claim what can be called in *in order*, so a venue in the
  book with an unread area that hides a liquidation makes that order wrong
  rather than short. `unrankedVenues()` narrows it to those venues and those
  gaps, so it shortens as they close.
- **A venue that answered and holds nothing says it on the spot**, because that
  is the one case where a gap and an empty account look identical.

Two things the acceptance leaves open, settled here:

- **A venue that answered about nothing is a failure, never a venue that
  answered in part.** Named in both it would be told that nothing failed, two
  rows under the line saying it went down. A venue that fails at one of its
  addresses and answers at another is still disclosed, though: dropped on the
  first failure, the wallet that did answer would go undisclosed with it.
- **Declaring a gap now costs a decision.** Every entry names the task that would
  close it, and `src/coverage-plan.test.ts` fails the build on a plan that is not
  a real task, one already finished, a liquidation-hiding gap filed under the
  aggregator, or one `ROADMAP.md` does not account for. Thirteen of thirty were
  in no plan at all when that was written.

There are five states, and each says which it is in its own words: `INCOMPLETE`
for a venue — or one of its addresses — that failed, `REMOVED` for a venue this
build dropped that a key is still stored for, `ALTERED` for a venue that spelled
an asset in characters this build could not draw, the per-venue sentence for one
that answered and holds nothing, and this, which is read where it is asked for.

The case in the notes: an account migrated to Aave V4 answers with nothing, no
venue fails, and the sentence under it names the third possibility — what it
holds may be in a part nothing here asks about — with `Aave V4, whose Core,
Prime and Plus Hubs on Ethereum hold real deposits` under `aave` in `/venues`.
