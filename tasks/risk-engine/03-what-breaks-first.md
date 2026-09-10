# 03 · What breaks first

**Status**: done
**Covered by**: `src/core/risk.test.ts`, `src/consistency.test.ts`, `src/cli/shell.test.ts`

## Goal

The default risk view: everything that can be liquidated, nearest first.

## Acceptance

- `breaks` lists positions ordered by absolute distance to liquidation.
- Shows venue, asset, kind, the move required, and what triggers it — a health
  factor or a liquidation price. There is no buffer column.
- Unknown distances appear at the end, labelled as unknown.
- Each row carries its `as_of`.

## Notes

This is the command that should make the product obvious in one screen. It is
worth more design attention than any other view.
