# 01 · Scope disclosure

**Status**: planned

## Goal

Say what the book does not cover, in the place the book is read.

## Acceptance

- One line with the view, naming what was never asked: the chains not read, one
  address per venue, the venues not built.
- Derived from what is registered, never written by hand. A sentence maintained
  beside the code it describes is the defect `src/site-claims.test.ts` exists to
  catch, and this one would go stale on the release that fixed it.
- **Not built and not connected are different things.** A venue with no connector
  is a gap; a venue the user chose not to connect is a decision, and naming it
  every time is nagging dressed as honesty. Only the first belongs on the line.
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
  `src/cli/shell.test.ts` for the line, and `src/agent/tools.test.ts` for the
  tool result — including the case where a venue added to the registry changes
  the line with no prose edited.

## Notes

`src/cli/commands.ts` prints `INCOMPLETE — N venue(s) failed. This is not your
full exposure.` A chain tula never queried is not a failure and produces no line
at all, so the one number tula exists to give is understated and nothing says so.
That is the failure the conventions call the worst available — a partial
portfolio served as complete.

Cheap, and it does not wait for 10. Someone whose Base wallet is unread is
under-counted today; this is the difference between a limit they were told about
and one they find out from a liquidation.
