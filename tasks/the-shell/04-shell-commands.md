# 04 · Venue-agnostic command set

**Status**: done
**Covered by**: `src/cli/shell.test.ts`, `src/consistency.test.ts`, `src/cli/oneshot.test.ts`

## Goal

The vocabulary of the daily driver. Structured commands first, and the plain
English that shipped beside them in this same milestone sits on exactly these.

## Acceptance

- `positions`, `exposure`, `breaks`, `shock <ASSET> <PCT>`, `venues`, `refresh`, `help`.
- No command requires naming a venue; venue scoping is an optional filter.
- Unknown input suggests the nearest command rather than dumping usage.
- Every command is callable one-shot and in-shell from one implementation.

## Notes

One implementation per command, shared by both entry points, or the two surfaces
drift and the shell becomes the second-class one.
