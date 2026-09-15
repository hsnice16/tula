# 11 · A question that runs over more than one line

**Status**: done
**Covered by**: `src/ui/line.test.ts`, `src/ui/keys.test.ts`, `src/ui/vim.test.ts`, `src/ui/terminal.test.ts`, `src/ui/screen.test.ts`, `src/ui/keymap.test.ts`

## Goal

Enter, Shift+Enter, Option+Enter and ctrl+j all submit, so the input line holds
one line and nothing more. A paste loses its line breaks to spaces, and a paste
ending in a newline submits before it can be read. A command fits on a line; a
question to the model often does not — a book described in three lines, a
scenario laid out as a list.

## What is standard

Enter submits and Shift+Enter inserts a newline, in every terminal AI tool
surveyed, and none of them relies on Shift+Enter alone, because most terminals
send the same byte for both unless the program asks for more:

| Tool | Newline keys | Source |
|---|---|---|
| Claude Code | `\`+Enter and ctrl+j "work in every terminal with no setup"; Shift+Enter where the terminal distinguishes it; Option+Enter with Option as Meta | `code.claude.com/docs/en/terminal-config`, `interactive-mode` ("Multiline input"), `keybindings` (`chat:newline`) |
| Codex CLI | ctrl+j, ctrl+m, Shift+Enter, Alt+Enter | `codex-rs/tui/src/keymap.rs`, `bottom_pane/chat_composer.rs`, `tui.rs` enabling key disambiguation |
| Gemini CLI | Shift+Enter, Alt+Enter, ctrl+Enter, ctrl+j, `\`+Enter | `docs/reference/keyboard-shortcuts.md`, `packages/cli/src/ui/key/keyBindings.ts` |
| opencode | `input_newline`: shift+return, ctrl+return, alt+return, ctrl+j | `opencode.ai/docs/keybinds` |
| Copilot CLI | Shift+Enter, Option/Alt+Enter | `docs.github.com/en/copilot/reference/cli-command-reference` |
| Warp Agent CLI | ctrl+j, Shift+Enter where distinguishable, Alt+Enter | `docs.warp.dev/cli/input-and-shell-commands` |
| fish | Alt+Enter | `fishshell.com/docs/current/interactive.html` |
| aider | Meta+Enter; "no portable way" to detect Shift+Enter | `aider.chat/docs/usage/commands.html` |

**Why the fallbacks exist.** A legacy terminal sends `\r` for Enter with or
without Shift. Alt+Enter is `ESC \r` and always distinguishable. Shift+Enter
arrives as its own sequence only under the kitty keyboard protocol
(`CSI 13;2u`, requested by the app), which Alacritty 0.16+, Ghostty, iTerm2,
WezTerm (behind `enable_kitty_keyboard`), Windows Terminal 1.25+ and VS Code
1.109+ (behind a setting) implement — `sw.kovidgoyal.net/kitty/keyboard-protocol`
and each terminal's own notes. Apple Terminal.app's support is contradicted
between sources and is checked rather than assumed. Under tmux it needs
`extended-keys`.

**What Ink gives.** Ink 7.1.1 requests the kitty protocol only when `render()`
is passed `kittyKeyboard` (`node_modules/ink/build/ink.js`), and `src/ui/run.tsx`
does not pass it. Its parser already reads `CSI 13;2u` as `return` with `shift`,
`ESC \r` as `return` with `meta`, and `\n` as `enter` without `return`
(`parse-keypress.js`). xterm's `modifyOtherKeys` form, `CSI 27;2;13~`, is not
parsed, and would reach the line as text.

### Checked against the sources

Read on 2026-09-14, not run. Codex at `3fa9039b`, Gemini CLI at `9c1b0a61`,
kitty at `3d9f394b`, tmux at `e880cf63`, vim at `2ec2a612`. Ink 7.1.1's parser
was run over each byte sequence below.

- **Claude Code — holds.**
  - `terminal-config`: "press Ctrl+J, or type `\` and then press Enter. Both
    work in every terminal with no setup."
  - `keybindings`: `chat:newline | Ctrl+J`.
  - `interactive-mode`: Option+Enter "after enabling Option as Meta on macOS",
    and ↑/↓ "when the input spans more than one visual row, whether wrapped or
    multiline, first moves the cursor within the prompt. Once the cursor is on
    the first or last visual row, pressing again navigates command history".
  - ctrl+a "in multiline input, moves to the start of the current logical
    line".
- **Codex CLI — holds, except ↑/↓.**
  - `insert_newline` is ctrl+j, ctrl+m, Shift+Enter and Alt+Enter
    (`codex-rs/tui/src/keymap.rs:1601-1607`).
  - It pushes keyboard enhancement flags (`tui/keyboard_modes.rs:130-166`) and
    pops them on exit and from the panic hook (`233-255`, `tui.rs:557-562`).
  - Paste is bracketed (`tui.rs:234`), and `handle_paste` turns `\r\n` and `\r`
    into `\n` and inserts without submitting (`chat_composer.rs:1225-1226`).
  - ↑/↓ are not "move between lines, then history": history is taken on an
    empty composer, or with the cursor at the very start or end of text that is
    still the entry last recalled (`chat_composer_history.rs:394-411`).
- **Gemini CLI — holds.**
  - Newline on ctrl+Enter, Alt+Enter, Shift+Enter and ctrl+j
    (`packages/cli/src/ui/key/keyBindings.ts:364-371`), and `\`+Enter in the
    Enter handler (`InputPrompt.tsx:1275-1277`).
  - It pushes kitty flag 1 only after `CSI ? u` is answered and pops it on exit
    (`core/src/utils/terminal.ts:22-42`); it has no crash path.
  - ↑/↓ move between visual rows and take history on the first and last
    (`InputPrompt.tsx:690-701`).
  - Its docs: "On macOS's Terminal: `shift+enter` is not supported."
- **opencode, Copilot CLI, Warp, fish, aider — hold** as the table states.
  Copilot CLI lists no ctrl+j.
- **The kitty protocol — holds.**
  - Under flag 1 "Enter, Tab and Backspace … still generate the same bytes as
    in legacy mode" (`docs/keyboard-protocol.rst:362-368`).
  - That exception is for the unmodified key: kitty's encoder sends `CSI 13;2u`
    for Shift+Enter (`kitty/key_encoding.c:179-230`), and Alacritty 0.16.0's
    notes fix exactly that case.
- **Terminals — corrected.**
  - WezTerm's `enable_kitty_keyboard` defaults to false.
  - Windows Terminal 1.25 is a preview; 1.24 is the stable release.
  - Apple Terminal.app is contradicted and stays unresolved. Claude Code's
    table says Shift+Enter "works without setup" there, Gemini CLI's docs say it
    is not supported, and Terminal.app is not on the kitty protocol's list of
    supporting terminals.
  - tmux forwards no kitty protocol. `extended-keys` sends modifyOtherKeys keys
    as `CSI 27;m;k~` or, with `extended-keys-format csi-u`, `CSI k;m u`
    (`tmux.1:4907-4955`).
- **xterm — holds by the manual's pattern.** modifyOtherKeys 2 sends shift+Tab
  as `CSI 27;2;9~`, so Shift+Enter is `CSI 27;2;13~`; Ink reads that as the
  text `[27;2;13~`.
- **Bracketed paste — holds.**
  - Readline's `enable-bracketed-paste` "insert[s] each paste into the editing
    buffer as a single string", on by default since 8.1.
  - zsh's `bracketed-paste` inserts "tabs and newlines … instead of invoking
    editor commands".
  - Ink 7 turns it on only while a `usePaste` hook is active
    (`hooks/use-paste.js`), delivers the paste as one event with its newlines,
    and turns it off on unmount (`components/App.js`).
- **Editing a multi-line buffer.**
  - zsh holds: `up-line-or-history` "Move up a line in the buffer, or if
    already at the top line, move to the previous event", `kill-line` "if
    already on the end of the line, kill the newline character", and each line
    command acts on the current line.
  - Readline does not document a buffer holding newlines.
- **Vim — holds**: `o`/`O` open a line below and above, `J` joins, `j`, `k`,
  `gg` and `G` are linewise (`insert.txt`, `change.txt:114`, `motion.txt`).

### Decisions

- **Newline keys**:
  - Shift+Enter, as kitty's `CSI 13;2u`.
  - Alt+Enter, as `ESC CR` or `CSI 13;3u`.
  - ctrl+Enter, as `CSI 13;5u`, which Gemini CLI and opencode bind.
  - ctrl+j, as LF or, under the protocol, `CSI 106;5u`.
  - Enter after a `\`, which removes it.
  - ctrl+m is not bound. Legacy terminals send it as Enter itself, so binding it
    would take Enter away.
- **The protocol is kitty flag 1, pushed only once the terminal answers**, as
  Gemini CLI does. Shift+Enter needs nothing more.
  - The app asks `CSI ? u` itself and pushes on the reply, whenever it comes.
    Ink's `kittyKeyboard` `auto` mode is not used: it listens for the reply
    beside the reader the app mounts. Under Bun that handed one reply to the
    input over and over, and a reply after its 200ms reached the line as `[?0u`.
  - Every input handler drops a reply to a question tula asked — this one, and
    the cursor position `src/ui/anchor.ts` asks for — so none is typed.
  - `holdInputModes` in `src/ui/terminal.ts` pops what Ink pushed and never
    popped, and turns bracketed paste off if Ink left it on, on `exit`, each
    fatal signal and an uncaught throw.
  - modifyOtherKeys is not requested. Gemini CLI's fallback is a second mode to
    hand back, and ctrl+j already covers what it would add.
- **`CSI 27;m;13~` is read as Enter with those modifiers.** tmux with
  `extended-keys` and xterm with modifyOtherKeys send exactly that for
  Shift+Enter, so reading it is what makes the key work there. Any other
  `CSI 27;…~` is dropped rather than typed.
- **Terminal.app is named nowhere.** The sources contradict each other, and a
  row claiming Shift+Enter there could be false. ctrl+j is the key stated as
  working everywhere.
- **A paste is inserted whole, newlines kept and never submitted**, with `\r\n`
  and `\r` made `\n` as Codex does. That holds on the shell's line only, where
  bracketed paste is on. A connect field, the Credentials box and the deletion
  prompt keep their single-line reading.
- **↑/↓ follow Claude Code and Gemini CLI**: they move between visual rows,
  wrapped or not, and take history on the first and last row. zsh agrees where
  nothing wraps. ctrl+p/ctrl+n do the same, as in Claude Code and zsh's `^P`.
  Codex's rule is the split, and is not taken: a cursor that moves up a row in
  one entry and recalls history in another, on the same key, is the case that
  leaves somebody unsure what the next press will do.
- **ctrl+a, ctrl+e, ctrl+u and ctrl+k act on the current line** (Claude Code,
  zsh). ctrl+k at the end of a line takes the newline, as zsh's `kill-line`
  does. Word motions and deletes cross lines.
- **The input holds 8 rows before it scrolls.** On a 24-row terminal, 8 rows,
  the two rules, the smallest menu of 4, its count, the status line and one
  hint row leave 7 rows of the answer above. When text is out of view the
  first or last of the 8 says how many lines are there.
- **A command stays one line.** A line starting with `/` that holds a newline
  opens no menu. On Enter it is refused with a sentence, kept on the line to
  fix, and not recorded.
- **Vim follows vim**:
  - `j`/`k` move a line and walk history from the first and last.
  - `o`/`O` open a line below and above.
  - `J` joins, with one space.
  - `dd`, `cc`, `yy`, `dj`, `dk`, `dgg` and `dG` are linewise, and `p`/`P` put
    a linewise register on its own line.
  - `0 ^ $ D C x h l` stay on the current line.
- **The suggestion** is drawn only when the cursor is at the end of the last
  line, and only up to the first newline of what it would add. Taking it takes
  what was drawn.

## Acceptance

- **Enter submits. Shift+Enter, Alt/Option+Enter and ctrl+j insert a newline**,
  and so does Enter on a line ending in `\`, which removes the `\` — the one
  form every terminal can send with no setting at all.
- **The kitty protocol is requested where the terminal supports it**: the
  app asks `CSI ? u` and pushes flag 1 on the reply (Ink's detection is not
  used), so Shift+Enter works without a terminal setting wherever it
  can. Where it cannot, the other three still do, and nothing on screen claims
  Shift+Enter works.
- **The terminal is handed back exactly as it was found.** The protocol is
  popped on every way out — exit, each fatal signal and an uncaught throw — for
  the same reason `trackMouse` undoes itself there: a shell left in the kitty
  protocol turns every later keystroke into escape codes, which reads as a
  broken terminal. `src/ui/screen.test.ts` or a unit test asserts the pop on
  each path, alongside the raw-mode guarantee
  [`hardening/01`](../hardening/01-hardening.md) already holds.
- **`CSI 27;2;13~` never reaches the line as text.** Read as Shift+Enter or
  dropped; the decision is written here with the reason.
- **A paste keeps its line breaks and never submits.** Bracketed paste is the
  standard way a line editor tells a paste from typing — checked against the
  Readline manual's `enable-bracketed-paste` and zsh's `bracketed-paste` widget
  before building, with Ink 7's support for it established in
  `node_modules/ink`. A pasted key is still refused by
  [`08`](08-saved-history.md)'s rule before it reaches history.
- **The editor is multi-line.** On a line that is not the first or last, ↑/↓
  move between lines; at the first line ↑, and at the last line ↓, walk history
  as they do on one line — Claude Code and Gemini CLI both behave this way,
  and the task file cites where. ctrl+a/ctrl+e, ctrl+k and ctrl+u act on the
  current line, as zsh does; word motions cross line breaks.
- **Vim mode follows.** NORMAL `j`/`k` move between lines and walk history at the
  top and bottom line, `o`/`O` open a line below and above, `J` joins, and `dj`,
  `dk`, `gg`, `G` act linewise — replacing the single-line notes in
  [`10`](10-vim-mode.md) with vim's own behaviour.
- **The completion keys keep their meaning.** A `/` menu or argument list open
  on the current line takes ↑/↓ and Enter as before; a ghost suggestion is drawn
  on the current line only.
- **A command stays one line.** A line starting with `/` that contains a newline
  is refused with a sentence saying commands take one line, rather than run with
  the rest silently dropped.
- **The input grows with its lines and the frame stays intact.** Every row still
  fits the width, the menu still sits below the input and holds its height, and
  the input is capped at a number of rows stated with its reason, scrolling past
  it. `src/ui/screen.test.ts` covers a three-line question at the four widths, a
  wrapped line inside it, a resize with it open, and the menu opened from its
  last line.
- **Connect fields and the credential-deletion prompt stay single-line**: a key
  or an address is one line, and a newline there is Enter.
- **History records a multi-line entry as one entry**, recalled whole.
- `AGENTS.md` and `README.md`'s Status row name them, and `src/ui/keymap.test.ts`
  holds both to the keymap. `/help` names no keys itself and points at `?` and
  `/keys`, and `site/components/Session.tsx`'s title bar names only the three it
  animates — the full list is [`12`](12-keys-reference.md)'s.

## Notes

The tester did not ask for this; the maintainer did, after the survey above
showed every comparable tool supports it and tula submits on all four keys.
