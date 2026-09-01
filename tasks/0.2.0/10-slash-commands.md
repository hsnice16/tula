# 10 · Slash commands

**Status**: done

## Goal

One unambiguous rule for what is a command and what is a question, with the
command surface discoverable by typing rather than by reading docs.

## Acceptance

- A line starting with `/` is a command; anything else goes to the model.
- Typing `/` opens a menu of every command with its arguments and a one-line summary.
- The menu filters as you type; ↑↓ moves, Enter runs the highlighted command, Tab
  completes it instead, Esc dismisses.
- An unknown command suggests the nearest match rather than dumping usage.
- `src/cli/registry.ts` is the single source: menu, help text, dispatcher and the
  one-shot CLI all read it.
- One-shot mode accepts the command with or without the slash.

## Notes

The earlier rule — "a known first word is a command" — made `exposure` a command
and `what is my exposure` a question, which is a distinction the user has to hold
in their head. A slash is visible and never ambiguous.
