# 10 · Vim mode, opt-in

**Status**: done
**Covered by**: `src/ui/vim.test.ts`, `src/ui/screen.test.ts`

## Goal

A vim editing mode for the input line, off unless somebody turns it on.

## What is standard

Every terminal AI tool comparable to this one ships it, and none turns it on by
default: Claude Code (editor mode in `/config`), Codex CLI (`/vim`,
`vim_mode_default`), Gemini CLI (`/vim`, an `[INSERT]`/`[NORMAL]` indicator),
aider (`--vim`), fish (`fish_vi_key_bindings`), zsh (`bindkey -v`), bash
(`set -o vi`).

**Where it applies:**

| Surface | Standard | Sources |
|---|---|---|
| The input line | the whole of vim mode; NORMAL `j`/`k` walk history once the cursor is at the line's top or bottom | Claude Code keybindings docs ("Vim mode handles input at the text input level"); Codex PR 18595 (a composer mode); zsh ZLE and bash manuals |
| A list that filters as you type — the `/` menu, the palette, an argument list | arrows and ctrl+n/ctrl+p in every mode; never bare `j`/`k`, which are letters being typed | Claude Code autocomplete; Codex `slash_input.rs` (no `j`/`k` arm); Gemini CLI and opencode keybinds; vim's own completion popup (CTRL-N/CTRL-P); fzf; telescope.nvim (`j`/`k` only in its normal mode) |
| Output in the terminal's own scrollback | no keys from the app; scrolling and search are the terminal's | Claude Code fullscreen docs (native scrollback "so Cmd+f and tmux copy mode work"); pager keys (`j`/`k`, `g`/`G`, Space/`b`, `/`) belong to an in-app pager such as `less` |

Claude Code's command set is the reference for the line, because it is the tool
somebody coming to this one is most likely to have in their fingers:

- **Modes:** INSERT and NORMAL, with the mode shown beside the line.
- **Entering INSERT:** `i I a A o O`.
- **Motions:** `h j k l`, `w e b` and `W E B`, `0 ^ $`, `gg G`, `f F t T` with
  `; ,`.
- **Operators:** `d c y` with any motion, `dd cc yy`, `D C`, `x`, `r`, `~`,
  `J`, `p P`.
- **Text objects:** `iw aw`, `iW aW`, `i" a"`, `i' a'`, `i( a(`, `i[ a[`,
  `i{ a{`.
- **Counts,** `.` repeat and `u` undo.

## Acceptance

- Off by default; `/vim` toggles it, the choice persists across sessions, and
  the one-shot CLI is untouched. It persists in a preferences file of its own
  under `configDir()` — not `credentials.json`, and not `state.json`, which is
  the update check's — and that file is the one later preferences go in.
- **Vim mode applies to the input line only.** The command set above, each
  motion and operator pinned in a unit test over the line model from
  [`07`](07-readline-keys.md), not only through the screen.
- In NORMAL, `j` / `k` walk history, as in Claude Code and Codex.
- **Lists are unchanged by the mode.** The `/` menu, the palette and the
  argument list of [`09`](09-argument-completion.md) move on arrows and
  ctrl+n/ctrl+p in both modes; `j` and `k` are never bound in them.
- **Output gets no keys.** The transcript is the terminal's scrollback, so
  nothing here scrolls or searches it; ctrl+o keeps its one meaning.
- **`/` in NORMAL opens the command menu.** The sources split — Codex opens its
  command menu, Claude Code searches history — and tula takes Codex's side for a
  reason it already states: a slash means a command, in either mode. History
  search stays on ctrl+r, from [`08`](08-saved-history.md), which is the
  readline standard.
- **Esc has one meaning at a time.** It dismisses the `/` menu, closes the
  palette and cancels a credential deletion. With vim on, the order in
  which an open list, a pending deletion and INSERT consume it is taken from
  the tools' own source and docs, read rather than run: nothing was installed
  and no user's configuration was changed. A second Esc must never do something
  the first one's screen did not show was coming. What was read, on 2026-09-14:
  - **Codex CLI**, `codex-rs/tui/src` at `b876f889`. With a popup open the
    composer dispatches to the popup before any vim check
    (`bottom_pane/chat_composer.rs:2056-2061`). The slash popup's Esc will
    "always dismiss the popup without changing the draft"
    (`chat_composer/slash_input.rs:237-243`). The vim INSERT Esc exists only on
    the no-popup path (`chat_composer.rs:3541-3543`), so the next Esc leaves
    INSERT (`textarea.rs:739-760`). The app does not interrupt a turn or start a
    rewind on that Esc while a popup is open (`bottom_pane/mod.rs:1591-1595`,
    `1626-1632`). In NORMAL, "`Esc` cancels the pending operator"
    (`keymap.rs:244`, bound at `1721`, handled at `textarea.rs:901-903`).
  - **fish** at `80928812`, `share/functions/fish_vi_key_bindings.fish:338-352`:
    "if we are paging, we want to stay in insert mode (#2871)". Esc cancels the
    pager and stays in insert; the next leaves it. Line `442` cancels a pending
    operator on Esc.
  - **Gemini CLI**, `packages/cli/src` at `9c1b0a61` — the split. Its vim
    handler runs first (`ui/components/InputPrompt.tsx:898-900`), before the
    suggestion Esc (`955-960`). INSERT's Esc goes to NORMAL (`ui/hooks/vim.ts:474-480`).
    A second Esc within 500 ms clears the whole buffer (`vim.ts:686-700`, `22`).
    A pending operator is cleared on Esc (`vim.ts:686-700`).
  - **Claude Code** docs (`code.claude.com/docs/en/keybindings`,
    `/interactive-mode`): `autocomplete:dismiss` is Escape, `confirm:no` is
    "N, Escape", and "the Escape key in vim mode switches INSERT to NORMAL mode;
    it does not trigger `chat:cancel`". Neither page says which wins when
    autocomplete is open in INSERT, nor what Esc does to a half-typed NORMAL
    command.
  - **Vim** at `2ec2a612` and **Neovim** at `aaee64e0`: `i_<Esc>` "End insert
    or Replace mode, go back to Normal mode" (`runtime/doc/insert.txt:49-51`).
    `popupmenu-keys` (`1422-1452`) does not list `<Esc>`, so the help implies,
    without saying, that one Esc ends completion and Insert together.

  Codex and fish take the list first and Gemini CLI and Vim take INSERT first.
  tula takes the list first. It is the only order in which a press never does
  something its screen gave no sign of. An open list is on screen, so closing it
  is the visible change. Gemini CLI's order hides the list and changes mode in
  one press, and its quick second Esc empties the line. fish states the same
  reason, and Codex is the tool whose NORMAL `/` tula already follows. Vim's
  popup is completion inside a buffer, not a list that filters what is typed.
  Every source that says anything about a pending prompt or operator agrees:
  Esc declines a prompt (Claude Code's `confirm:no`) and cancels a half-typed
  command (Codex, Gemini CLI, fish). So one Esc, in this order:
  1. an open `/` menu, argument list or palette closes, and the mode stays;
  2. a pending credential deletion is kept (the prompt puts the line in INSERT,
     because it asks for a name to be typed);
  3. INSERT becomes NORMAL, a character to the left, as vim leaves it;
  4. in NORMAL, a half-typed command is dropped.

  Where 1 or 2 takes the press, a half-typed command goes with it. Nothing on
  screen shows a pending `d`, and keeping it would let the next key delete
  something no frame warned about. Gemini CLI's double-Esc clear is not taken.
- Enter submits from either mode; Tab and the completion keys from `09` work in
  INSERT.
- `ConnectFlow` stays readline-only, as a masked field is not an input line the
  tools above apply their vim mode to.
- The mode indicator is in the palette from `src/ui/theme.ts` and never red,
  which is semantic.
- `src/ui/screen.test.ts` covers the indicator at the four widths and a mode
  switch with the menu open.

## Notes

Depends on `07` for word motions, the delete buffer and undo, and on `09` for
the lists it leaves alone.

The input holds several lines since [`11`](11-multi-line-input.md), and
`src/ui/vim.ts` keeps vim's own meaning over them:

- `j` and `k` move a line, keeping the column, and walk history from the first
  and last line.
- `o` and `O` open a line below and above.
- `J` joins lines with one space.
- `dd`, `cc`, `yy`, `dj`, `dk`, `dgg` and `dG` are linewise, and `p` and `P`
  put a linewise register on a line of its own.
- `0 ^ $ D C x h l`, `f F t T` and `r ~` stay on the current line.
- A change and the text typed into it undo as one `u`.

The indicator is `-- INSERT --` / `-- NORMAL --`, as Claude Code draws it, at
the head of the status line under the input, so turning vim on or switching
modes moves no row. Vim starts in INSERT, so turning it on does not change what
the next keystroke does. The choice is kept in `preferences.json` under
`configDir()`, written by `src/prefs/prefs.ts`.
