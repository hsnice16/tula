# 01 · Hardening pass

**Status**: planned

## Goal

Everything that must be true before strangers paste keys into this.

## Acceptance

- An external security review of the credential path and the connect flow.
- Fuzzing over venue responses: malformed, hostile and truncated.
- Every venue-supplied string treated as data on every path that renders it.
- Rate-limit and backoff behaviour verified against each venue.
- No panic path leaves the terminal in raw mode.
