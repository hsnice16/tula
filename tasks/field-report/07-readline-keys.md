# 07 · Readline keys on every line somebody types into

**Status**: done
**Covered by**: `src/ui/line.test.ts`, `src/ui/screen.test.ts`

## Goal

The editing keys every shell, REPL and terminal AI tool accepts, accepted here.
The input line takes ←, →, backspace and nothing else: `app.tsx` drops every
other ctrl or meta chord before it reaches the line, so ctrl+a, ctrl+w and
alt+b do nothing at all — not even an error. `ConnectFlow.tsx` has no cursor,
so a mistyped character in the middle of an address costs the whole address.

## What is standard

GNU Readline's emacs bindings are the baseline — bash and python take them from
Readline itself, zsh and fish mirror them. Checked on 2026-09-14 against the
[Readline manual](https://tiswww.case.edu/php/chet/readline/readline.html)
(bindable commands, and the default keymap in bash-5.3's
`lib/readline/emacs_keymap.c`), [Claude Code's interactive-mode
docs](https://code.claude.com/docs/en/interactive-mode), [Gemini CLI's
keyboard shortcuts](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/keyboard-shortcuts.md)
and Codex CLI's `codex-rs/tui/src/keymap.rs` defaults:

| Keys | Readline command | Claude Code | Gemini CLI | Codex CLI |
|---|---|---|---|---|
| ctrl+a / ctrl+e, Home / End | `beginning-of-line` / `end-of-line` | yes | yes | yes |
| ctrl+b / ctrl+f | `backward-char` / `forward-char` | ctrl+b is background tasks | ctrl+f only | yes |
| alt+b / alt+f | `backward-word` / `forward-word` | yes | yes | yes |
| ctrl+← / ctrl+→, alt+← / alt+→ | not bound | — | yes | yes |
| ctrl+w | `unix-word-rubout` — back to whitespace | yes, "back to previous whitespace" | yes | yes |
| alt+backspace | `backward-kill-word` — back to a word | yes | yes | yes |
| alt+d | `kill-word` | yes | yes | yes |
| ctrl+u | `unix-line-discard` | yes | yes | yes |
| ctrl+k | `kill-line` | yes, "stores deleted text for pasting" | yes | yes |
| ctrl+y | `yank` | yes | ctrl+y is YOLO | yes, one buffer |
| ctrl+d on a non-empty line, Delete | `delete-char` | yes | yes | yes |
| ctrl+t | `transpose-chars` | task list | TODO list | transcript |
| ctrl+_ | `undo` | yes | ctrl+z instead | — |
| ctrl+p / ctrl+n | `previous-history` / `next-history` | yes | yes | yes |

Corrections this table made to the task as first written:

- **ctrl+w's word is not alt+backspace's.** `unix-word-rubout` is "using white
  space as a word boundary"; `backward-kill-word`'s "word boundaries are the
  same as backward-word", whose words "are composed of letters and digits".
  Claude Code documents the same split. On `/hyperliquid status` ctrl+w takes
  `status` then `/hyperliquid`; alt+backspace stops at the slash.
- **ctrl+t drags, it does not swap the two before the cursor.** It moves the
  character before the cursor over the one under it, and only "if the
  insertion point is at the end of the line" swaps the last two.
- **Consecutive kills are one entry.** "Any number of consecutive kills save
  all of the killed text together", so ctrl+w ctrl+w ctrl+y puts back both
  words. `yank-pop` (alt+y) is not bound: Codex keeps one buffer too.
- **Option on macOS.** Claude Code: alt shortcuts "require configuring Option
  as Meta in your terminal". Gemini CLI instead reads `∫` as alt+b; that turns a
  character somebody can type into a command, so tula does not.

**ctrl+k: kill-line keeps it, and the palette moves to ctrl+s.** Every tool in
the table binds ctrl+k to delete-to-end, and none of them binds it to a
palette; the palette binding comes from web apps, which have no line editor
competing for it. Terminal tools that do have a palette put it on ctrl+p
(opencode `command_list`, Crush), which Readline and all three tools above
spend on history. ctrl+s is Readline's `forward-search-history`, which in bash
and zsh most people never reach because the tty's `IXON` flow control eats it
— Readline leaves `IXON` as the tty had it (`rltty.c`), while Ink's raw mode
clears it (libuv `uv_tty_set_mode`, `UV_TTY_MODE_RAW`), so here it arrives.
Outside a search, a forward search from the newest line finds nothing, so the
key is free; inside ctrl+r's search ([`08`](08-saved-history.md)) it keeps
Readline's and Codex's meaning, the next newer match.

## Acceptance

- Every row above works on the shell's input line, in the `/` menu's filter and
  in the palette's query, and ctrl+p / ctrl+n move the selection in both lists
  exactly as ↑ / ↓ do.
- `ConnectFlow` gets a cursor and the same keys on every field.
- **A word is what readline calls one**: alphanumerics, so `0x12ab…` is one
  word and `/hyperliquid status` is two. Stated in a test, because every
  hand-rolled word motion disagrees with the one somebody's fingers learned.
- **alt arrives two ways and both work.** macOS Terminal and iTerm2 send ⌥+b as
  `∫` unless "Use Option as Meta" is on; with it on they send `ESC b`. The
  escape-prefixed form is the one that can be bound; the Unicode form is a
  character somebody may be typing and is never swallowed. ctrl+← / ctrl+→ are
  the word motions that work with neither setting, which is why both are here.
- **ctrl+k was the palette; it is kill-line.** Both are standard in their own
  family — the palette binding comes from editors and web apps, the kill from
  every shell. The palette is on ctrl+s, and `site/components/Session.tsx` and
  the input line's placeholder follow. The `/` help
  text states no keys, so it has nothing to change. This bullet first said
  `src/site-example.test.ts` fails on a frame whose keys drift. It does not: it
  checks the frame's rows against the registry, and the key names in the title
  bar are checked by nothing.
- **Nothing typed into a secret field reaches the delete buffer.** ctrl+w on a
  masked field deletes as usual, and ctrl+y on the shell line afterwards puts
  back nothing from it — a kill ring that carried an API secret out of the
  masked field onto a visible line is the key on screen.
- ctrl+c, ctrl+d on an empty line, ctrl+l and ctrl+o keep their meanings.
- `src/ui/screen.test.ts` drives each binding into the emulator at the four
  widths, including a line that wraps: a cursor motion over a wrapped row is
  the case that leaves Ink's erase short.

## Notes

This sits under [`10-vim-mode`](10-vim-mode.md): a vim mode needs word motions,
a delete buffer and undo, and every one of them is built here first.
