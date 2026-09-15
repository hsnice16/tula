# 13 · Typing while an answer is still coming

**Status**: done
**Covered by**: `src/ui/screen.test.ts`, `src/ui/keymap.test.ts`

## Goal

While a command or a question is running, the input line takes no keys: after
ctrl+c, ctrl+l and ctrl+o, every key reaches `if (busy) return` in
`src/ui/app.tsx` and is dropped. A question that takes a minute to answer is a
minute somebody cannot start typing the next one, and what they typed in that
minute is gone without a sign it was ever received. The maintainer noticed it
by using the tool.

## What is standard

Read on 2026-09-14, not run. Claude Code from its `interactive-mode` and
`keybindings` docs; Codex at `5fb3b7e4` (paths under `codex-rs/tui/src/`); Gemini
CLI at `9c1b0a61`; opencode at `a74c472f`; aider at `5dc9490b`.

- **Typing while busy — the input stays editable** in Claude Code, Codex, Gemini
  CLI (`isInputActive` includes `Responding`, `AppContainer.tsx:1503-1510`) and
  opencode (`packages/tui/src/component/prompt/index.tsx:947-960`). aider has no
  prompt while it streams (`aider/coders/base_coder.py:885-890`).
- **Enter while busy — the split.**
  - Claude Code queues: "Claude Code queues the message instead of interrupting
    the turn, and lists the queued entries above the input box". Commands are
    held "until the turn ends, then runs them one at a time".
  - Gemini CLI queues by default (`AppContainer.tsx:1463`), steering only behind
    the experimental `modelSteering` (`settingsSchema.ts:2320-2328`), and refuses
    to queue a slash command (`InputPrompt.tsx:467-485`).
  - Codex steers: Enter goes into the running turn (`chatwidget/input_flow.rs:34-52`)
    and Tab queues (`bottom_pane/chat_composer.rs:3577-3584`).
- **Queued lines — above the input** in all three.
  - Gemini CLI: "Queued (press ↑ to edit):", three rows and "+N more"
    (`QueuedMessageDisplay.tsx:9,25-46`).
  - Codex: `↳` rows under "Queued follow-up inputs"
    (`bottom_pane/pending_input_preview.rs:150`).
- **Taking one back.**
  - Claude Code: ↑ "from the first line" takes back all of them, one per line.
  - Gemini CLI: ↑ on an empty buffer takes all of them back joined
    (`InputPrompt.tsx:519-532`).
  - Codex: Alt+Up takes back the newest only
    (`chatwidget/interaction.rs:125-135`, `input_restore.rs:228`).
  - Claude Code: "clear the input box to drop it".
- **Order.** Claude Code and Codex send one per turn, oldest first
  (`input_restore.rs:170-172`, `input_flow.rs:199`). Gemini CLI joins the whole
  queue into one message (`useMessageQueue.ts:69-83`).
- **Esc while busy — stops the turn**: Claude Code ("Stop the current response or
  tool call mid-turn"), Codex (`bottom_pane/mod.rs:816-825`), Gemini CLI
  (`useGeminiStream.ts:945-957`); opencode on a second press
  (`prompt/index.tsx:406-419`). In Claude Code's vim mode Escape "switches
  INSERT to NORMAL mode; it does not trigger `chat:cancel`".
- **ctrl+c while busy — the split.** Claude Code interrupts. Codex clears a
  draft if there is one and interrupts otherwise (`bottom_pane/mod.rs:886-891`).
  Gemini CLI does both at once (`AppContainer.tsx:1814-1818`). aider interrupts
  (`base_coder.py:1572-1582`).
- **The queue after a stop.** Claude Code: "If you have messages queued, Claude
  Code sends them next". Gemini CLI leaves it to send once idle — read from the
  code, not documented. Codex puts it back in the composer instead
  (`input_restore.rs:284-286`).
- **tula before this task.** Nothing stopped a running question: `Agent.ask`
  took no signal, and ctrl+c while busy cleared the line or left tula. The SDK's
  stream takes a `signal` and rejects with `APIUserAbortError`. `ask` already
  rolled the conversation back to before the question on any error, so a
  stopped question could not leak into the next one. A command's reads run through
  `request()` in `src/core/http.ts`, whose only signal is its deadline.

### Decisions

- **The input takes every key while busy**, lists included, as in Claude Code,
  Codex and Gemini CLI.
- **Enter while busy queues** (Claude Code, and Gemini CLI by default).
  - Codex's steer is not taken. tula cannot put a line into a turn already out
    with the model, and a command has no turn to steer.
  - Unlike Gemini CLI, a command queues too, as in Claude Code, which is what
    "a queued command and a queued question are handled alike" asks.
  - Unlike Claude Code, a question queued during a tool round is not slipped
    into that round. It waits for the turn to end, for the reason Codex's steer
    is not taken.
- **One line at a time, oldest first** (Claude Code, Codex). Gemini CLI's join
  is not taken: two commands joined are one command that runs over two lines,
  which [`11`](11-multi-line-input.md) refuses.
- **Queued lines are drawn above the input** as `↳` rows (Codex), under a
  "queued" heading, at most three and a count of the rest (Gemini CLI). A queued
  line is echoed and recorded in history when it runs, not when it is queued, so
  one taken back and cleared is never recorded.
- **↑ on an empty line, with lines queued, takes back the newest** into the
  input. The condition is Gemini CLI's; taking only the newest is Codex's, for
  the reason the join is refused. With nothing queued, ↑ is history as before.
  Clearing what was taken back drops it.
- **Esc while busy stops a running question**, once no list, palette, panel or
  search has taken it, and — with vim on — once INSERT has become NORMAL (Claude
  Code's order).
  - The part of the answer already on screen stays, with a line saying it was
    stopped and left out of the conversation.
  - What is queued runs next (Claude Code, and Gemini CLI's code).
- **ctrl+c while busy clears the line if it has text, and stops the question
  otherwise** (Codex). It never leaves tula while something is running, so a
  second press meant to stop cannot exit.
- **A running command is not stopped.** Stopping one means carrying a signal
  through `src/core/http.ts` and every connector, which is not this task. Esc or
  ctrl+c on a command says so on the busy row, with the deadline that ends it,
  so the press still shows on screen.

## Acceptance

- **The input line takes every key while busy**: typing, the editing keys of
  [`07`](07-readline-keys.md), the newline keys of
  [`11`](11-multi-line-input.md), history, and `?`. Nothing typed is dropped.
- **Enter while busy does what the standard above settles**, and the screen says
  what happened to the line — queued, sent, or refused with the reason — so no
  line disappears without a word.
- **A queued line runs exactly once, in order**, after the one ahead of it has
  finished, including when that one failed or was stopped. A queued command and
  a queued question are handled alike.
- **What reaches history does not change**: a line is recorded when it is
  submitted, by [`08`](08-saved-history.md)'s rules, and a queued line that is
  cancelled before it runs is not.
- **The lists keep their meaning while busy**: the `/` menu, the ctrl+s palette,
  argument completion and the suggestion work as they do when idle, so a
  command can be picked while something else is still running.
- **The busy row stays where it is.** `AGENTS.md`'s rule that a wait says what it
  is waiting on for the whole of the wait holds, and nothing under the cursor
  moves on its own: queued lines are drawn where the standard puts them without
  shifting the line being typed. `src/ui/screen.test.ts` covers typing, a queued
  line and the busy row together at the four widths and across a resize.
- **A connect flow and the credential-deletion prompt are unaffected**: they are
  modal and own their input as before.
- The keymap from [`12`](12-keys-reference.md) lists any key whose meaning
  changes while busy, on its own row, and `keymap.test.ts` holds it.
