# 09 · Completing arguments, and a suggestion as you type

**Status**: done
**Covered by**: `src/cli/registry.test.ts`, `src/cli/shell.test.ts`, `src/ui/screen.test.ts`

## Goal

Completion stops at the second word. `/hyperliquid ` offers the venue's
subcommands; `/shock ` offers nothing, so the asset has to be known and spelled
the way the book spells it, and `/connect ` offers no venue. Nothing is
suggested for a line that does not start with a slash. The tester asked for
"auto-complete (on-enter/select)"; this task builds what the standard below
says those keys do.

## What is standard

What Enter does depends on the kind of list open, and the sources agree on each
kind except where noted:

| List | Enter | Tab | Sources |
|---|---|---|---|
| Command menu (`/`) | runs the highlighted command; a command that takes arguments is put on the line instead, with its argument list opened; nothing highlighted sends the line as typed | inserts, never runs | Claude Code `commands` and `interactive-mode` docs; Gemini CLI PRs 13985 and 14584 ("Tab always auto-completes, never auto-executes"); opencode keybinds. Codex runs an argument-taking command with whatever follows its name — the split. |
| Command palette (ctrl+s) | runs | — | GitHub command palette docs; VS Code user-interface docs |
| Argument completion inside the line | inserts the candidate and closes the list; a second Enter runs the line | inserts | fish `reader.rs` ("return while navigating the pager… only clears the pager"); zsh `complist` (`accept-line` accepts the match "but do not cause the command line to be accepted"); IPython shortcuts; vim `popupmenu-keys`; Codex `@` menu. Bare prompt_toolkit and readline's `menu-complete` submit instead — the split. |
| Ghost suggestion after the cursor | never takes it; runs what was typed | takes it, where no list is open | fish ("won't execute unless you accept it", → or ctrl+f); zsh-autosuggestions `config.zsh`; prompt_toolkit (→, ctrl+e); Warp (→, ctrl+f); Claude Code (Tab or →, "then Enter to submit") |

Candidates are declared per argument position, each with a description beside
it: fish `complete -a` under `__fish_seen_subcommand_from`, prompt_toolkit's
`NestedCompleter`. A suggestion draws from history first and completion second:
zsh-autosuggestions' `(history completion)` strategy.

## Acceptance

- **The command menu keeps what it does**, which is the standard row above:
  Enter runs a highlighted command whose arguments are all optional, puts one
  that requires arguments on the line — and now opens that command's argument
  list at the cursor — and sends the typed line when nothing is highlighted. Tab only ever
  inserts. The argument hint the registry already declares (`<asset>
  <percent>`) is shown on the row, as Claude Code shows `argument-hint`.
- **Every argument `src/cli/registry.ts` declares states where its candidates
  come from**, and the list offers exactly what the command accepts at that
  position, filtered as typed and described:
  - `/connect` — every venue in the build; `/forget` — stored venues;
  - `/shock` — the assets `/shock` accepts, so the list and the refusal cannot
    disagree: both are the loaded book's assets, and `shock()` refuses any other
    by name and lists what is held;
  - `/update` — `install`;
  - the account labels of a venue holding several, wherever a command takes
    one.
- **In the argument list, Enter inserts and closes; the next Enter runs.** Tab
  inserts. ↑/↓ and ctrl+p/ctrl+n move, per [`07`](07-readline-keys.md).
- **A candidate that needs a load does not trigger one.** Before anything is
  loaded the asset list says it has nothing to offer and which command loads it,
  rather than fetching every venue because somebody typed a space.
- **A ghost suggestion**, from saved history ([`08`](08-saved-history.md)) first
  and the completion candidates second, drawn in the theme's dim colour after
  the cursor. → or ctrl+f takes it whole at the end of the line, ctrl+e takes it
  there too, alt+f takes one word, and Tab takes it whenever no list is open.
  Enter runs the line as typed and never takes it.
- **A suggestion never shows a secret.** It draws only from what `08` records,
  so nothing typed into `ConnectFlow` can reach it, and it is off on any line the
  credential-deletion prompt owns.
- `AGENTS.md`'s "Enter runs, tab completes" bullet gains the argument-list and
  ghost-suggestion rows, with the sources.
- `src/ui/screen.test.ts`: an argument list opened from Enter on `/shock`, Enter
  inserting then running, and a suggestion that would run past the last column
  cut rather than wrapped, at all four widths — a wrapped suggestion is a row
  Ink counts once and draws twice.
