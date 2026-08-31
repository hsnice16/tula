# 03 · Interactive query shell

**Status**: done

## Goal

The prompt a user types into. A question-and-answer loop, not a dashboard.

## Acceptance

- `tula` with no arguments opens the shell; one-shot commands still work.
- Line editing, history, and tab completion over the command set.
- Ctrl-C cancels the current line; Ctrl-D exits cleanly.
- Every rendered figure carries its `as_of`.
- The banner states how many venues are connected and how fresh the data is.

## Notes

First built on `node:readline`, then replaced by the Ink surface in task 06. The
readline prompt was correct plumbing and the wrong front door: it read as a
generic REPL, which is exactly what this product is not.
