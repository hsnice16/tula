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

`NOT READ — N area(s) of <venues> were never asked for, so anything held there is
missing from these figures. The rest of them answered. /venues names each.`

One line, beside the freshness of the view, on every command that reports a
figure and on every tool result including a filtered one. It is built by
`disclosure()` and `notReadLine()` in `src/core/coverage.ts` out of each
connector's own `coverage.doesNotRead`, so it shrinks when a connector starts
reading something and disappears when the last gap closes.

Two things the acceptance leaves open, settled here:

- **The line names the venues and counts the areas; the areas themselves are one
  command away.** Nineteen of them on one line is the wallpaper the bullet above
  is written against. `/venues` groups every area under its venue, and
  `/<venue> status` lists that venue's own; both open with what the gap costs the
  reader — value, a liquidation, or what you can move — rather than with the
  endpoint that goes unread. The agent gets the whole list in
  `get_venue_status.never_asked_for` and the flag on everything else.
- **A venue that answered about nothing is a failure, never a venue that
  answered in part.** Named in both it would be told that nothing failed, two
  rows under the line saying it went down. A venue that fails at one of its
  addresses and answers at another is still disclosed, though: dropped on the
  first failure, the wallet that did answer would go undisclosed with it.

There are four states now, not three, and each says which it is in its own
words: `INCOMPLETE` for a venue — or one of its addresses — that failed,
`REMOVED` for a venue this build dropped that a key is still stored for,
`NOT READ` for a venue that answered about part of the account, and the
per-venue sentence for one that answered and holds nothing. That last one names
the third possibility beside it wherever the venue declares something unread:
what it holds may be in a part nothing here asks about.

The line for the case in the notes: an account migrated to Aave V4 answers with
nothing, no venue fails, and `NOT READ` names `aave` with `Aave V4, whose Core,
Prime and Plus Hubs on Ethereum hold real deposits` under it in `/venues`.
