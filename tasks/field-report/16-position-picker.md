# 16 · Picking a position to expand

**Status**: done
**Covered by**: `src/ui/screen.test.ts`, `src/ui/keymap.test.ts`, `src/core/detail.test.ts`

## Goal

`/positions` prints as it does today, with a one-line hint that any position can
be expanded. A key opens a picker — a modal list of every position, arrow keys,
Enter, wheel and click — and Enter opens that row's detail from
[15](15-position-detail.md) in the same modal. Esc goes back to the list, and
again closes it.

## Why a picker and not the table itself

The first design, 2026-09-28, moved a highlight through the `/positions` table
in the transcript with ↑/↓, auto-pressing `ctrl+o` when ↓ ran past the visible
rows and never collapsing on ↑. Three things in the shell rule that out:

- **The transcript is `<Static>`** — written once. Highlighting a row means
  rewriting the whole transcript per key press, the redraw a resize costs.
- **An expanded 176-row book is taller than the screen**, the terminal owns the
  scrollback, so the highlighted row cannot be kept in view, and Ink redraws the
  whole screen when its live region outgrows it.
- **Mouse tracking is off while the transcript is read** so numbers can be
  drag-selected (`src/ui/mouse.ts`). Clickable rows would need it on always.

A modal windows its own list (`src/ui/scroll.ts`), so the `ctrl+o` edge case
does not arise, and it takes type-to-filter — "eth" beats ↓ forty times.

## Acceptance

- `/positions` gains a hint, drawn as its own line rather than a row of the table.
- The picker lists every position the book holds, filters as you type, and
  scrolls by keys and wheel; mouse tracking is on only while it is up.
- Enter or a click opens the detail; Esc steps back; a click outside closes.
- The key that opens it, and the hint's wording, go in `src/ui/keymap.ts` so
  `?`, `/keys`, the README and the site list it.

## The key

↓ on an empty line, once history is at its newest line — ↓ there has nothing
left to recall. Claude Code reaches its footer item the same way: `history:next`
on Down, and a `footer:down` context past the input's edge
(code.claude.com/docs/en/keybindings; its changelog's "Fixed ↓ in shell mode
selecting a hidden background-tasks pill"). vim's `j` past the last line does
the same, as Claude Code's does.

Not a ctrl chord: GNU Readline's emacs map binds every ctrl letter but o and x
(tiswww.case.edu/php/chet/readline/readline.html), ctrl+o is already the
shell's expand key and ctrl+x is the emacs prefix; ctrl+a and ctrl+b are the
screen and tmux prefixes. Not Tab on an empty line: it is completion, and
overloading it is the ambiguity `09` removed.

`/positions` says so on a line of its own under the answer, which a table cut
short does not cut.
