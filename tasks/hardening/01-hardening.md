# 01 · Hardening pass

**Status**: planned — the raw-mode and venue-string items already hold

## Goal

Everything that must be true before strangers paste keys into this.

## Acceptance

- An external security review of the credential path and the connect flow.
- Fuzzing over venue responses: malformed, hostile and truncated.
- Every venue-supplied string treated as data on every path that renders it.
  **Holds on both surfaces** — `src/core/untrusted.ts` bounds and strips it where
  it enters rather than where it is drawn, `src/agent/tools.ts` marks each such
  field so the model is told which text is a venue's rather than tula's, and a
  name that had to be cleaned is said out loud as `ALTERED` with the venue that
  sent it. `scripts/guard-test.sh` plants a sentinel through the data path, so
  a route that renders a venue's string unmarked fails the build rather than a
  review.
- Rate-limit and backoff behaviour verified against each venue.
- No panic path leaves the terminal in raw mode. **Holds on both surfaces** —
  `trackMouse` (`src/ui/mouse.ts`) undoes itself on `exit`, on each fatal signal
  and on an uncaught throw, because Bun does not reach `exit` from one; the
  one-shot prompt (`src/cli/prompt.ts`) restores on both ways out of the read.
