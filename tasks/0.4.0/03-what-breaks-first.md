# 03 · What breaks first

**Status**: done

## Goal

The default risk view: everything that can be liquidated, nearest first.

## Acceptance

- `breaks` lists positions ordered by absolute distance to liquidation.
- Shows venue, asset, the move required, and the current buffer.
- Unknown distances appear at the end, labelled as unknown.
- Each row carries its `as_of`.

## Notes

This is the command that should make the product obvious in one screen. It is
worth more design attention than any other view.
