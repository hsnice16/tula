# 08 · History that outlives the session, and ctrl+r

**Status**: done
**Covered by**: `src/history/history.test.ts`, `src/ui/screen.test.ts`, `src/cli/oneshot.test.ts`, `src/site-claims.test.ts`, `scripts/guard-test.sh`

## Goal

↑ recalls what was typed earlier in this session and nothing before it:
`history` is component state in `app.tsx` and dies with the process. Every
shell and terminal AI tool keeps it across sessions and searches it with
ctrl+r, so somebody who ran `/shock ETH -20%` yesterday retypes it today.

## What is standard

Checked on 2026-09-14 against the bash and zsh manuals and sources, the
Readline manual, fish's interactive docs, Claude Code's interactive-mode docs
and Codex CLI's source.

- **A history file per user, readable by that user alone.** bash opens it
  `0600` (`histfile.c`, including the temp file it truncates through), zsh
  `0600` (`Src/hist.c`), and Codex sets `0o600` on `~/.codex/history.jsonl` and
  then checks it is owner-only. Neither manual states the mode; the sources do.
- **ctrl+r searches backwards incrementally**, and ctrl+r again steps to the
  next older match (Readline, zsh, Claude Code, Codex). ctrl+s steps back to a
  newer one (Readline `forward-search-history`, Codex).
  - **Enter runs the match**: Readline ("a RET terminates the search and
    accepts the line"), zsh `accept-line`, Claude Code ("accept and execute").
    Codex puts it on the line instead, and is the exception.
  - **Esc takes the match onto the line to edit**, running nothing: Readline
    ("the ESC and C-j characters terminate an incremental search"), and Claude
    Code ("Tab or Esc to accept the current match and continue editing"). Codex
    restores the draft on Esc — the split. This task first said Esc leaves the
    line as it was, which the two sources above contradict.
  - **ctrl+g restores the line as it was** (Readline: "C-g aborts an
    incremental search and restores the original line"), and so does ctrl+c
    (Claude Code, Codex).
  - **Any other editing key takes the match and then does its job**: "a
    movement command will terminate the search, make the last line found the
    current line, and begin editing" (Readline) — so → and ctrl+e take it with
    the cursor where they put it. ↑/↓ step through matches, as in Codex and
    Claude Code's fullscreen search.
- **A line starting with a space is not recorded.** In bash (`ignorespace`) and
  zsh (`HIST_IGNORE_SPACE`) it is an option that is off by default; fish does
  it unasked ("prefixing the commandline with a space will prevent the entire
  line from being stored in the history"). tula takes fish's default.
- **An immediate repeat is recorded once**: bash `ignoredups`, zsh
  `HIST_IGNORE_DUPS`, and Claude Code by default ("submitting the same prompt
  twice in a row records one history entry").
- **The file is capped.** bash's `HISTSIZE` defaults to 500 and `HISTFILESIZE`
  to that; Codex caps by `history.max_bytes`.
- **Recording can be turned off**: `unset HISTFILE` in bash, `SAVEHIST=0` in
  zsh, `history.persistence = "none"` in Codex.

## Acceptance

- ↑ / ↓ and ctrl+p / ctrl+n walk history across sessions, newest first.
- ctrl+r opens an incremental reverse search with the standard keys above, and
  says what it is searching and that nothing matched rather than leaving the
  line unchanged in silence.
- **Recorded:** what was submitted on the shell's input line — commands and
  questions alike.
- **Never recorded** — beyond what any shell does, and on purpose: a shell
  records every line, and this one is typed into on the same keyboard that
  pastes exchange keys. Each is pinned by a test that types it and reads the
  file:
  anything typed into `ConnectFlow`, secret or not; the name typed to confirm a
  credential deletion; a line starting with a space; and any line
  `.githooks/scan-staged`'s credential patterns would refuse, because
  somebody pasting a key onto the wrong line is the case this file must not
  make permanent.
- The file lives under `configDir()` and is created 600, as shells create
  theirs. Refusing it — not repairing it — on the same `lstat` and ownership
  checks `src/secrets/store.ts` makes is beyond shell practice, for the reason
  the bullet above gives. It
  is its own file: the module writing it imports nothing from `src/secrets/`,
  for the reason `src/update/state.ts` gives.
- Consecutive duplicates collapse; the file is capped, and the cap is a number
  in the code with the reason beside it.
- `/history clear` empties it, and one documented way turns recording off
  entirely. What a stored line reveals is an address and questions about the
  book — somebody's positions in their own words — so both are stated on
  `SECURITY.md` beside the credential store, and `src/site-claims.test.ts` gains
  the claim.
- One-shot `tula <command>` records nothing: that line is already in the
  calling shell's own history, and a second copy is a second place to clear.
- `scripts/guard.sh` holds: no path in the credential-holding modules can reach
  the new write.

## Notes

The ghost-text suggestion in [`09-argument-completion`](09-argument-completion.md)
reads from this file.
