# AGENTS.md

Instructions for AI coding agents (Claude Code, Cursor, Codex, Devin, etc.) working on this repo.

> `CLAUDE.md` is a one-line pointer to this file. AGENTS.md is the cross-agent standard; one source of truth avoids drift.
>
> Human contributors should read [CONTRIBUTING.md](./CONTRIBUTING.md) — same rules, phrased for PR workflow.

## What this project is

A terminal tool that answers one question no venue can: **what is my real exposure,
and what breaks first?** — across centralized exchanges, perp DEXs and lending
protocols at once.

See `README.md` for the product narrative, `ROADMAP.md` for the milestones and
the versioning rules, and `tasks/` for the work breakdown.

## Versioning

[SemVer](https://semver.org), and the version describes a **release**, never a
plan — the milestones live in `ROADMAP.md` precisely so a reordered plan cannot
make a published number wrong. Pre-1.0: **patch** for fixes, security hardening
and doc or site corrections; **minor** for a new venue, command or capability,
and for anything breaking; **major** is reserved for `1.0.0` and `2.0.0`.

A hyphen means pre-release. It is the only signal — `src/version.ts` derives
`IS_PRE_RELEASE` from `APP_VERSION`, and `release.yml` reads the same hyphen to
choose `--prerelease` over `--latest` and the npm dist-tag. They were once a
hand-set boolean apart and had already drifted into a stable release whose
binary called itself a pre-release; `guard.sh` now fails if the derivation is
replaced by a literal.

## Stack

- **Ink 7 + React 19** for the terminal UI; **`@anthropic-ai/sdk`** for the agent
  (`claude-opus-5`, adaptive thinking, streaming). Ink 7 needs Node >= 22.
- **TypeScript**, strict, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Bun** — package manager, test runner, and `bun build --compile` to a single binary.
- **decimal.js** — every quantity and price. Never `number` for money; a float
  rounding error in a liquidation distance is a wrong answer that looks right.
- **Node built-ins only** for I/O (`node:crypto`, `node:fs/promises`). Each new
  dependency is a supply-chain path into a process that reads exchange keys.
- **`@xterm/headless`, dev only** — the emulator `src/ui/screen.test.ts` renders
  into. Ink sizes a frame by counting newlines and erases that many rows next
  render, so a row that wraps is a row it never takes back: the defect exists
  between the bytes we write and the grid they land on, and no assertion over
  the React tree can reach it. Pure JS, nothing to compile, never in the binary.
- **Every dependency is pinned to an exact version**, and `bun.lock` is committed
  so transitive versions are pinned too. A caret range is a standing promise that
  code nobody has read yet is safe to run against credentials. CI installs with
  `--frozen-lockfile`; upgrades are a deliberate, reviewable commit.
- **Actions are pinned to a commit SHA, never a tag**, and `bun-version` is an
  exact number. A tag is mutable: whoever controls it can repoint it at new code
  that runs inside the release job, which holds `attestations: write` — the
  identity every install verifies against. A floating tag there would let a
  compromised action sign a malicious binary as genuine. The trailing `# v4`
  comment is for the reader; only the SHA is load-bearing.

## Run anything

```bash
bun install
bun run typecheck      # tsc --noEmit
bun test               # unit tests
bun run check          # typecheck + test + install path + guard + guard-test, what CI runs
bun run build          # -> dist/tula
bun run dev            # run from source
```

There is no fixture venue. Wallet, Hyperliquid and Aave read from a public
address, so any address exercises the whole path without credentials:

```bash
export TULA_CONFIG_DIR=/tmp/tula-try
bun run src/index.ts            # / -> wallet -> connect -> paste any 0x address
```

`TULA_CONFIG_DIR` redirects the credential store. Always set it in scratch runs
so nothing touches a real `~/.config/tula`. `TULA_ETH_RPC` overrides the
Ethereum RPC; `TULA_TOKEN_LIST` overrides the Token Lists URL wallet balances
are read against; `TULA_PRICE_PAGES` widens price coverage beyond the top 500 if
you have a paid CoinGecko key.

## Definition of done

A change is finished when all of this is true, not when it works:

1. **`bun run check` passes.** Typecheck, tests, the install path and `guard.sh`.
   The `pre-commit` hook runs it in full and refuses the commit otherwise; CI
   runs the same commands. Never bypass it to "fix it in the next commit".
2. **Nothing secret is in the diff.** `.githooks/scan-staged` runs first and
   cannot be undone by a later commit — once a key is in history, rotating it is
   the only remedy. Public values it should stop flagging go in `allowed-secrets`
   with the reason.
3. **The repository still agrees with itself.** A new module appears in the
   Layout below; a changed behaviour is reflected in `README.md`, `CHANGELOG.md`
   and this file. `guard.sh` fails on a module nobody documented. A doc that
   describes what the code used to do is worse than no doc.
4. **Every comment still earns its place.** Say why, not what. A comment that
   restates the code is a second copy that drifts, and it will be believed after
   it is wrong. Deleting a stale one is as much of the change as writing it.
5. **It was run, not just compiled.** `src/ui/screen.test.ts` drives the real
   component into a real terminal emulator and asserts on the rendered grid —
   one input box, two rules, no row past the last column — across four widths,
   a viewport too short for the menu, and a resize. Add a case there for any
   frame a change can leave behind. It still is not the same as looking: run it
   and read the screen before calling it done.

## Layout

```text
.githooks/
  pre-commit            # the CI gate, plus a secret scan; `bun run prepare-hooks`
  scan-staged           # refuses staged content that looks like a credential
  allowed-secrets       # public values the scan would otherwise refuse, and why
install.sh              # the published installer; served from the site, tested in CI
scripts/
  guard.sh              # the SECURITY.md promises, enforced
  guard-test.sh         # plants a write path in src/ and expects guard.sh to name it
  release-cut.sh        # bumps the version, dates the changelog, stops before the tag
  release-build.sh      # cross-compiles the four published targets
  install-test.sh       # runs install.sh against a fake release, under a curl shim
  npm-pack.sh           # stages @hsnice16/tula and its per-platform packages
  homebrew-formula.sh   # renders a formula from a built release
src/
  index.ts              # command dispatch; catches TulaError for clean exits
  version.ts            # APP_NAME, APP_VERSION, REPO_URL — single source
  core/
    position.ts         # canonical schema: Position, NetExposure, LiquidationParams
    exposure.ts         # netExposure, portfolioValue, oldest
    risk.ts             # liquidation distance, scenario shocks, what breaks first
    prices.ts           # PriceOracle interface (one oracle per process)
    http.ts             # request() — the only way out to the network, deadline included
    format.ts           # quantity, freshness, usd, pct — the only renderer of a figure
    errors.ts           # TulaError — user-actionable vs. bug
  connectors/
    types.ts            # Connector, KeyScope (tri-state), isOverScoped, unverified
    kraken.ts           # HMAC over the payload digest; scope partly unprovable
    binance.ts          # HMAC over the query string; scope fully provable
    coinbase.ts         # CDP keys over JWT (ES256 / EdDSA); scope fully provable
    hyperliquid.ts      # public address, no credential — perps + spot
    aave.ts             # public address over RPC — collateral, debt, health factor
    wallet.ts           # public address — native ETH and ERC-20s off a token list
    stripe.ts           # restricted key; fiat balances, per-currency minor units
    circle.ts           # restricted key; scope unprovable, so it stays unknown
    evm.ts              # ABI encode/decode and batched eth_call
  secrets/
    store.ts            # credential store; never imported by src/agent/**
  agent/
    engine.ts           # RiskEngine — the ONLY thing the agent layer may see
    tools.ts            # tool definitions + executor; figures leave here rendered
    agent.ts            # streaming loop, claude-opus-5; explain() for API failures
    signin.ts           # delegates the browser flow to `ant auth login`
    fixture.ts          # a RiskEngine over fixed data, for tests
  prices/
    providers.ts        # the selectable sources; exactly one is active per process
    coingecko.ts        # the default; symbol->id map is explicit, never guessed
    coinmarketcap.ts    # ranked quotes over a keyed data API
    cryptocompare.ts    # keyed; answers 200 with an error envelope, so check it
    coinpaprika.ts      # keyless; explicit market-cap rank settles contested tickers
  cli/
    prompt.ts           # no-echo secret entry, one prompt per declared field; TTY and piped
    session.ts          # one fetch per shell session; refresh is explicit; reports each step
    commands.ts         # one implementation per command, shared by shell and one-shot
    registry.ts         # THE command surface: menu, help, dispatch, one-shot CLI
    shell.ts            # dispatchCommand over the registry
    engine-adapter.ts   # Session -> RiskEngine; the only bridge to the agent
  ui/
    app.tsx             # Ink surface: owns ALL key handling, output, status line
    Credentials.tsx     # sign-in: asked once at first run, and again from /login
    ConnectFlow.tsx     # in-app venue connect; masks secret fields
    SlashMenu.tsx       # filtered menu, grouped; fixed height, below the input
    Palette.tsx         # ctrl+k: the same surface flattened and ranked, floated over the screen
    theme.ts            # the palette; no colour literal belongs anywhere else
    brand.ts            # the venues' and price sources' own colours, sampled from their artwork
    TextInput.tsx       # presentational input line; no key handling
    keys.ts             # paste vs. keystroke; what a trailing newline means
    mouse.ts            # wheel and pointer reports; why tracking is on only while a list is up
    anchor.ts           # asks the terminal where its cursor is, to place the inline menu on screen
    scroll.ts           # windowing a list longer than its rows; shared by the menu and the palette
    wrap.ts             # rows, not lines — what truncation counts
    run.tsx             # render + waitUntilExit
    resize.ts           # redraws the screen on a width change; Ink's erase miscounts rewrapped rows
    table.ts            # column layout
```

Commands live in `commands.ts` and are called by both `shell.ts` and `index.ts`.
Two implementations would drift, and the shell would become the second-class one.

## The hard boundary (architecturally important)

```text
6  TUI shell                     <- src/ui (Ink)
5  Agent layer                   <- src/agent
═══════════ HARD BOUNDARY ═══════════
4  Risk engine                   <- src/core/risk.ts
3  Price oracle                  <- src/core/prices.ts
2  Normalizer (canonical model)  <- src/core/position.ts
1  Connectors (read-only)        <- src/connectors
```

Two rules, and they are the reason the architecture exists:

1. **The agent queries layer 4, never a venue API and never the secret store.**
   `src/agent/**` imports the `RiskEngine` interface and core types — nothing else.
   `scripts/guard.sh` fails the build if it ever imports a connector or the store.
   An LLM doing arithmetic in context produces wrong numbers non-deterministically;
   deterministic code computes every figure and the model narrates it.

   **Figures cross the boundary already rendered**, by `src/core/format.ts` — the
   same functions the tables use. Rounding is arithmetic, so handing over a raw
   `Decimal` and asking for two places asks for the one thing rule 1 forbids;
   handing over `"$27.75"` makes the rule enforceable rather than merely stated,
   and stops the model's prose disagreeing with the row above it.
2. **Layer 2 is the product.** Everything else is plumbing. Design effort belongs
   in the canonical position model.

## Conventions

- **Unknown is a value, not a default.** `KeyScope.canTrade` is `'unknown'` when
  unprovable; `NetExposure.notional` is `null` without a price. Never collapse
  either to `false`/`0` — a confident wrong answer is worse than an admitted gap.
- **Freshness travels with the number.** Every `Position` carries `asOf`; every
  aggregate inherits the *oldest* contributor. Never render a figure without it.
- **One renderer per kind of figure.** `src/core/format.ts` owns quantities,
  money, percentages and freshness; tables, prose and tool results all call it.
  A second `toFixed` anywhere is a second answer to the same question.
- **Degrade loudly.** A venue that fails prints `INCOMPLETE` and exits non-zero.
  Silently serving a partial portfolio as complete is the failure that costs money.
- **Every network call goes through `request()` in `src/core/http.ts`**, never a
  bare `fetch` — `guard.sh` fails the build on one. Nothing else bounds how long
  a call takes, and a venue that never answers has to fail in order to be named.
  The deadline is a raced timer, not `AbortSignal` alone: the signal bounds the
  wait for a response, not for a connection, so against an unreachable host it
  fires only after the OS connect timeout.
- **Signed quantities.** Debt and shorts are negative so netting is a plain sum.
- **Ordering is presentation.** Connectors return what the venue gave them; the
  command layer sorts. A new connector must not change how the table reads.
- **Commands stay authoritative.** Every view has a structured command behind it.
  The model is never the only path to an answer, and the product works with no API key.
- **A slash means a command; anything else is a question.** No heuristic, no
  ambiguity. Add a command by adding it to `src/cli/registry.ts` and a case in
  `dispatchCommand` — the menu, palette, help text and one-shot CLI all follow.
- **Browsing and searching want opposite orders.** `/` is grouped and
  alphabetical, because that is the only order somebody can predict before they
  have learned the list. ctrl+k is flat and ranked, and reaches `/<venue> <sub>`
  in one step. Neither is the other's fallback, which is why they are two
  components over one `registry.ts`.
- **A key a terminal cannot receive is not a binding.** `cmd` never reaches a
  TTY — the terminal emulator consumes it — so every shortcut here is `ctrl+`.
- **Nothing under the cursor may move on its own.** The menu sits *below* the
  input and holds a fixed height, so filtering never resizes the block the line
  you are typing on rests against. Motion for its own sake is the other failure:
  a typewriter reveal on a table of numbers reads as the tool being slow.
- **A modal is exactly the viewport, never a row more and never a row less.**
  Ink composites a frame into a cell grid, so an absolute box overlaps its
  siblings — but <Static> is not in that grid, so a dialog floats over a redraw
  of the screen, and the redraw is the whole of it. A row short leaves that copy
  scrolled in under the real transcript with nothing to put the real one back; a
  row over and Ink clears on every keystroke. Exactly the viewport counts as
  fullscreen, and leaving it is what makes Ink reprint <Static>. Opening clears
  first: growing a frame to fill the screen scrolls it, and rows that go over
  the top are past recall.
- **One width for a block and for the count of what it hides.** The preview and
  its "22 more lines" wrap against the same width, or the count is measured in
  rows the block does not have.
- **ctrl+o expands in place; it does not open a pane.** What was held back joins
  the transcript where the question that produced it already is, and the line
  you type on does not move. A pane hides the question to show the answer, which
  is the problem truncation was introduced to solve. Because the transcript is
  <Static>, the mode change costs the same screen-and-scrollback redraw a width
  change does — so it is skipped when nothing is truncated.
- **The frame's width is never a number of cells.** Ink repaints on the resize
  event itself and paints the tree it already holds — components do not re-run
  first — so a width measured before a drag is laid into a terminal that has
  since narrowed. Those rows wrap, Ink sizes a frame by counting newlines and
  counts each as one, and its next erase leaves the remainder standing: one
  ghost per resize, stacking. So the inset is `paddingRight` on the root and
  panels stretch to their container, both of which Yoga re-derives on that same
  repaint. `frameWidth` is for arithmetic we do ourselves — what a preview wraps
  at, what the count of what it holds back is measured in — and never for laying
  anything out. A floating dialog is the exception: narrower than the frame by
  construction and truncated row by row, so a stale width costs it nothing.
- **A resize is not debounced.** Every frame between the drag starting and a
  debounce firing is laid out against dimensions that are already wrong, which
  is the defect above with a longer window. Ink throttles its own painting to
  30fps; there is no render storm left for a debounce here to prevent.
- **Venues are commands too.** Every venue in the build is in the `/` menu with its
  status inline, and `/<venue> <sub>` scopes an action to it. There is no separate
  discovery step, and the menu doubles as the venue overview.
- **Colour comes from `src/ui/theme.ts`.** Dulled gold, because it is the unit
  everything here is measured against; a saturated yellow reads as a warning, and
  that meaning is held in reserve. Red stays semantic, never decorative. The one
  palette outside it is `src/ui/brand.ts`: those colours are other people's, and
  restyling them to match ours is what would make them stop identifying anyone.
- **A third party is named with its mark.** Every venue and price source carries
  a `●` in its own colour in the `/` menu, ctrl+k and the connect screen. The
  gutter is at the head of the summary, not of the row: the names are the column
  being read down, so a mark in front of them would indent the ones that have it.
  It is the one thing an unselected row may light up — a mark is identity, not
  emphasis. A venue added without an entry in `src/ui/brand.ts` renders a hole
  beside the rest, which `src/ui/brand.test.ts` fails on.
- **Help belongs at the step that needs it.** Connectors declare `help` links to
  official pages; they are rendered in the connect flow, not collected in a docs dump.
- **All key handling lives in `app.tsx`.** The slash menu and the line editor
  compete for the same arrow keys and Enter; two input hooks cannot agree on who won.
- **Enter runs, tab completes** — in the `/` menu and in ctrl+k alike. Completing
  on both is what cost every command a second Enter, the first spent closing a
  menu. The one exception is a command with arguments left to supply: those
  cannot be guessed, so Enter puts it on the line with the cursor where the
  first one goes.
- **A wait says what it is waiting on.** `Session` reports each venue as it reads
  it and the spinner counts the seconds off. Behind a fetch that is a 15s
  deadline per venue, a bare "working" is indistinguishable from a hang — and
  the session is the only layer that knows which venue it is on, because a
  command reaches `ensureLoaded` several layers below the UI.
- **Comments say why.** A comment that restates the code is a second copy that drifts.
- **The model's failures are ours to translate.** `explain()` in `src/agent/agent.ts`
  turns an API error into a sentence with a next step. A raw `overloaded_error`
  envelope printed at somebody asking about their money is not an answer.
- Tests live beside the code as `*.test.ts`.

## What the user reads

Two rules, enforced by `scripts/guard.sh`, that outlive any one change:

1. **Nothing suggests this is a sketch.** No "demo", "dummy", "fake", "toy",
   "playground", "just a test", "for now" in anything a user can see. People are
   deciding whether to point this at their entire net worth; a stand-in account or
   a hedging word costs more trust than it saves effort. If a thing is not ready,
   say precisely what it does not do yet — `README.md` has a Status table for that.
2. **Every dead end names the way out.** A message that reports a problem without
   a next step is unfinished. A venue that fails says which command explains it. An
   empty result says what would have to be true for it to be non-empty. A rejected
   key says what kind of key to make instead, with the venue's own link. A missing
   API key says the command that sets one.

Applies to errors, empty states, connect screens, comments and commit messages
alike. The test: read the line as somebody stuck at 2am with money at risk — does
it tell them what to do next?

## Security / threat surface (read before changing I/O)

tula is non-custodial, and read-only for the moment — placing trades will come
later. That removes theft of funds but not risk to data: it builds an aggregated
view of one person's entire cross-venue net worth, and holds a key to every
venue in it.

1. **No credential may reach LLM context.** The command layer reads
   `src/secrets/store.ts` to save and hand credentials to connectors; the agent
   layer (`src/agent/**`) must never import it, and no value returned to that
   layer may contain one. No `read_file` tool over the config, no splicing
   config into a prompt, no logging tool I/O that includes credentials.
2. **Never ask for a seed phrase.** On-chain reads take a public address. A
   seed-phrase field is a phishing template. The one private key tula loads is
   Coinbase's CDP API key, and `guard.sh` fails on key handling in any other
   file.
3. **Verify key scope at connect time.** `Connector.verifyScope` must call the
   venue and refuse anything that can withdraw — permanently, trading or not.
   A key that can trade is refused too, wherever the venue will say so. Not
   documented — checked.
4. **Bound every string somebody else writes.** Two reach the screen and the
   model: an asset symbol and a venue's error text. Both are capped and
   flattened to one line in `src/cli/session.ts`, where all seven connectors
   arrive. They are data, never instructions. No memo, NFT metadata or protocol
   description is read — a third source has to be bounded there and listed in
   `SECURITY.md` in the same commit.

Never add a code path that can place an order, and never import a venue's order
endpoint — including "validate only" variants. The absence is the product.

## Adding a connector

1. Implement `Connector` in `src/connectors/<venue>.ts`.
2. `verifyScope` must probe the real venue. Return `'unknown'` rather than
   guessing; never probe by mutating state.
3. Declare `fields` (what connecting asks for, and which are secret) and `help`
   (official links only). The connect flow is generic and reads both.
4. Map into `Position` with signed quantities, an explicit `delta`, and `asOf`
   set to when the data was received.
5. Normalize the venue's asset names to canonical symbols; unit-test the odd ones.
6. Register it in `CONNECTORS` in `src/index.ts`; the menu picks it up automatically.
7. Do not sort — the command layer does that.

## Working from tasks/

Point a session at one file: `Work on tasks/0.2.0/03-interactive-shell.md`.

The agent reads that task for goal and acceptance criteria, the version's
`README.md` for scope, and this file for conventions. Update the task's
`**Status**:` line when it lands, and add a `CHANGELOG.md` entry.

## Things to leave alone

- The refusals in `src/secrets/store.ts`: mode 600, `lstat` rather than `stat`,
  and a config directory nobody else may write to. They refuse rather than warn
  on purpose. The file is plain JSON and stays that way — a key kept beside the
  ciphertext protects nothing, and a passphrase breaks the commands that run
  unattended — so those three checks are the entire defence, and the security
  page says so in those words rather than implying encryption.
- The signature test vector in `src/connectors/kraken.test.ts`. It is Kraken's
  published example; if it drifts, every private call fails as
  `EAPI:Invalid signature`, which reads as a bad key.
- The cap and the control-character strip in `decodeString` (`src/connectors/evm.ts`)
  and in `reason()` (`src/cli/session.ts`). A decoded symbol and a venue's error
  text are the two strings somebody else writes that are rendered *and* sent to
  the model; both are capped and flattened to one line so neither can pose as an
  instruction. `SECURITY.md` lists exactly these two, so a third has to be added
  there in the same commit.
- The tri-state `KeyScope`. Collapsing it to booleans reintroduces the lie. It
  is also per-power on purpose: when trading ships, `isOverScoped` drops its
  `canTrade` clause and the withdraw refusal stands unchanged.
- `decimal.js` on every quantity.

## The site

`site/` is a **separate package** — Next.js 16 (App Router, RSC-first), React 19,
Tailwind 4 with `@theme` tokens in `app/globals.css`, Biome, static-exported to
GitHub Pages. It has its own `package.json` and lockfile on purpose: its
dependency tree must never join the binary's, which is the one that reads
exchange keys. Nothing in `site/` is imported by `src/`, and nothing in `src/` is
imported by `site/`.

```bash
cd site && bun install     # node 22 on PATH; see the environment note below
bun run dev                # http://localhost:3000/tula/ — basePath applies here too
bun run build              # -> site/out, static
```

- **Node 22 is required to build it**, not the default v18. Use
  `export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"`, and `bun` as the
  package manager.
- `basePath` is `/tula` because a GitHub Pages project site is served from
  `/<repo>/`. A custom apex domain later drops it and adds `public/CNAME`
  instead. `public/.nojekyll` is required or Pages' Jekyll step drops `_next/`
  and the site loads unstyled.
- **Internal links use `<Link>` from `components/Link`, never `next/link` and
  never a raw `<a href="/...">`.** Next applies `basePath` to a `<Link>` and not
  to a raw anchor, so the anchor points outside the site and 404s — in `next dev`
  as well as in production, since `basePath` is not a production-only setting. The wrapper adds `scroll={false}`: Next's own reset puts the new
  page at the top in the frame it renders, and `components/Scroll` is what walks
  the reader up there instead — it cannot animate a jump already taken.
  `guard.sh` fails on both a raw anchor and a direct `next/link` import.
- **Off-site links use `<Ext>`, never a raw `<a>`.** It carries the `_blank`
  target every external link on the site opens with, and the `rel` that keeps the
  opened page from reaching back through `window.opener`. Between the two rules
  no page should contain a bare anchor at all.
- `install.sh` lives at the repository root, where CI tests it, and the Pages
  workflow copies it into `public/` at build time. `site/public/install.sh` is
  generated and gitignored — two copies of a script people pipe into a shell is
  one copy too many.
- `app/not-found.tsx` is the 404, exported to `out/404.html` — the one file
  GitHub Pages serves for every path under `/tula/` it has nothing at. It is not
  in `NAV`, which is the list of routes the sitemap and `llms.txt` publish, and a
  404 in either is a 404 arrived at from a search result.
- `agentRules: false` in `next.config.ts`: `next dev` otherwise writes a second
  AGENTS.md and CLAUDE.md under `site/`, and this file is the only one.
- **The changelog and the roadmap are not on the site.** `CHANGELOG.md`,
  `ROADMAP.md` and `tasks/` are read where they are written, on GitHub. They had
  been rendered at build time, which kept them honest but meant every status edit
  redeployed the site; the repository is the one place they can be edited and
  read as the same file. Nothing under `site/` may reach up to the repository
  root for content again — `lib/content.ts` and `lib/markdown.ts` existed only
  for those pages and are gone with them.
- `scripts/guard.sh` holds `site/app`, `site/components` and `site/lib` to the
  same language rule as `src/`.
- **English only**, here and in the README: the name is described as taken from
  Sanskrit rather than written in Devanagari, so nothing depends on a reader's
  font or script. The wordmark and the etymology line are gone from the site. The
  name's origin belongs in `README.md`, not in front of someone deciding whether
  to trust a binary.
- **One vertical rhythm, and it scales with the viewport.** Every section opens
  on `pt-step`, and every gap between two of them is three of those, composed or
  stated. The `--spacing-step*` tokens in `globals.css` are one clamp, so no page
  can space its sections unlike the others, and a phone is not handed the 216px a
  desktop gets between them — a quarter of its screen with nothing in it.
  `--gutter` clamps for the same reason. A section gap belongs in these tokens,
  not in a raw step count.
- **The header and footer bars centre below the `phone` breakpoint.** A wordmark
  held left against a nav held right is a shape that needs a row wide enough for
  both ends; wrapped, `ml-auto` leaves each half on the edge it was pushed to and
  they read as two halves that missed each other. `globals.css` says why the
  breakpoint sits where it does.
- **One command per terminal frame on the install page.** Every frame carries
  a copy button, so two alternatives sharing one is a paste that installs
  tula twice — which is why Homebrew and npm are separate frames, and why
  update, go back and remove are three. Sequential steps may share one.
- **A table that would scroll sideways stacks instead.** The install page's
  "what it runs on" rows carry the note that answers the question, and a
  sideways-scrolling table puts it off a phone with nothing to say it is there.
  Horizontal scroll is right for the terminal frames, which are a picture of a
  fixed-width grid, and wrong for anything a reader has to read.
- **Six client component files, and each one earns it by needing something
  CSS cannot read.** `Session.tsx` draws the front page's frame and works `/`,
  ctrl+k and ctrl+o on a loop because a transcript cannot show a keystroke —
  every state it passes through is one the binary draws, in the binary's own
  palette (`src/ui/theme.ts`, not the site tokens) and down to the counts under
  each list. Opening the menu takes its rows out of the transcript rather than
  adding them under it, and the transcript is clipped from the top: that is the
  only direction a terminal loses a row in, and the alternative grows the page.
  The frame's banner prints the version, so `site/lib/site.ts` restates
  `APP_VERSION` and `guard.sh` fails when the two disagree. `Ask.tsx` runs the same
  frame through a question: the spinner row is overwritten as it works and then
  replaced by the answer, so a still frame is the one picture of tula answering
  that cannot contain it. That row is `activity` in `src/ui/app.tsx`, not the
  status line under it, which goes on saying what is loaded throughout. It
  shows `thinking` and one tool label and no more —
  the model asks for its tools in a single turn and `src/agent/agent.ts` runs
  that batch synchronously, so every label but the last is overwritten before
  Ink paints. It rests on the answer rather than on the work, because that is
  the state a reader who has turned motion off is left with.
  `Note.tsx` leans its card toward the pointer.
  `Copy.tsx` puts a command on the clipboard and holds the answer for a
  moment; it is handed the text rather than reading it back out of the
  block, and its live region sits outside the button, because a button's
  children are presentational and a region nested in one is not reliably
  announced.
  `Nav.tsx` measures where the active item sits so one underline can travel
  between them. `Scroll.tsx` scrolls the next page to the top, and sits out a
  back or forward, where the reader is returning to a place they already had;
  it also holds the back-to-top button, which rides above the footer rather
  than over it — the moment somebody most wants that button is the moment they
  have reached the site's other set of links, so the footer's visible height is
  measured and the button lifted by it.
- **The header is rendered by `app/layout.tsx`, not by each page.** A `<Nav>` per
  page is a new one per route change, and an underline that remounts cannot
  travel from where it was.
- **Every claim the security page makes is pinned by `src/site-claims.test.ts`.**
  Numbers were pinned long before words were, and the words drifted first: the
  page promised a guard check that only ever matched Kraken, said tula never
  handled key material while the Coinbase connector loaded an EC private key,
  and said the installer refuses what it cannot verify when without the GitHub
  CLI it installs and says so. The test holds every surface that makes the claim
  to the same wording, refuses the retracted phrasings by name, and checks each
  promise against the guard or the module behind it.
- **A claim that will expire is worded so it can be extended, never retracted.**
  Trading is coming, so no surface says tula *cannot* place an order full stop:
  each carries "placing trades will come later", and the promise stated flatly
  is the one that never moves — funds do not leave a venue. A withdrawn security
  promise reads as though it was never true.
- **`lib/site.ts` holds every string more than one file states**: the name, the
  one-sentence description, the keyword list, the nav routes with the blurb each
  one is summarised by, and the preview card's dimensions and alt text. The nav
  blurbs feed the header, the sitemap and `llms.txt` from one place, so a fourth
  page cannot ship unindexed or unsummarised. `src/site-claims.test.ts` reads
  this file rather than `layout.tsx` for the trading caveat — the description is
  written here and rendered there.
- **`metadataBase` is the deployed URL including `/tula`.** Next resolves every
  canonical, `og:url` and image against it, and one without the base path
  publishes canonicals at an origin that serves the account's own pages.
- **The preview card is `app/og.png/route.tsx`, not Next's `opengraph-image`
  convention.** That convention exports a file with no extension at all, which
  GitHub Pages serves as a byte stream — and a card crawler drops any image
  whose content type is not an image, a failure invisible from the site itself.
  A route handler whose path carries `.png` gets the type right, at the cost of
  naming the image by hand in `OG_IMAGE` rather than having Next infer it.
- **Every metadata route needs `export const dynamic = 'force-static'`.** Under
  `output: export` the build refuses to collect a route it cannot prove is
  static, and a `new Date()` in the sitemap is enough to make it doubt.
- **`robots.txt` here is read by nothing**, for the same reason `security.txt`
  is: a crawler fetches it from the origin root, which on a project site belongs
  to the account, and `hsnice16.github.io/robots.txt` is a 404 — which crawlers
  read as "allow everything". It grants nothing that is not already granted, and
  is kept as the written record of the policy rather than as load-bearing.
  Discovery is what has to work instead: `llms.txt` is linked from the footer of
  every page, and the sitemap is submitted by hand. A domain is deferred and not
  planned — `tasks/1.0.0/03-docs-site.md` says why — so nothing here waits on
  one.
- **`llms.txt` links to `/security` rather than restating it.** It is the file
  nobody would think to update, so a security promise copied into it is the copy
  that goes stale. What it may state is what `lib/site.ts` already holds.
- **`components/JsonLd.tsx` renders schema.org, and only ever restates the page
  it sits on.** Structured data is a second encoding of a claim, never a place
  to make a new one — nothing there is checked by a reader who can see the page.
- **The site is measured; the binary is not.** `components/Analytics.tsx` loads
  GA4 and nothing else, and only in a production build — `next dev` would
  otherwise file a developer's own reading as traffic. The id sits in
  `lib/site.ts` rather than in an env var because the Pages workflow sets no
  environment: an id read from `process.env` would deploy a page carrying no tag
  at all, with nothing to report the absence. `anonymize_ip` is deliberately not
  passed — GA4 truncates the address itself and ignores it, so sending it would
  advertise a control that is not ours to offer. The security page's egress card
  names the split, because the reader is on the site while it happens.
  `GOOGLE_SITE_VERIFICATION` sits beside the id: it is Search Console ownership,
  and it stays after the property verifies, because Google re-checks the tag and
  un-verifies when it goes — taking the sitemap and the index coverage with it.
- **`public/.well-known/security.txt`** is RFC 9116. It belongs at the domain
  root, which on a project site belongs to the account, so it moves there with
  the apex domain and `Canonical` says where it is until then. `guard.sh` fails
  30 days before `Expires`: a lapsed one is a published invitation to report
  through a channel nobody promises to read.
- **Every number the front page states is pinned by `src/site-example.test.ts`.**
  Both blocks that quote the tool — the command transcript and the answer to
  the plain-English question — are recomputed from one synthetic book, the
  scenario included, down to the claim that nothing liquidates under it. They
  are scanned separately: the prose and panels between them are full of lengths
  and sizes that a figure test cannot tell from figures. The page is read as
  text, never imported: the two dependency trees must not meet. The preview
  card is held to the same book: its venue rows must match the page's character
  for character, and it states the netted figure and the liquidation distance
  the engine computes. A link pasted into a chat is the whole of the site for
  most people, and nobody scrolls past a picture to a correction.
- **The rows the frame's two lists draw are pinned by the same file.** `/` and
  ctrl+k can only be published as a picture, so `Session.tsx` holds their rows
  as literal tables — a second copy of the command surface, which drifts. The
  test rebuilds them from `src/cli/registry.ts` against the same book, checks
  each table's order, and checks the counts the lists owe the reader — what the
  menu left below, and what the palette did — against how many rows the page is
  left drawing, so neither can be edited without the other.
  It also holds the venue marks to `src/ui/brand.ts` in both directions: a hue
  that has drifted names a neighbouring brand, and a colour no row is left
  drawing is one nobody would notice going wrong.
- **The overview names no model vendor.** "Connect a model", not the one the
  binary happens to send to today. A second provider then costs no copy edit,
  and the page never has to carry a "more coming soon" — a hedge on the page
  somebody is using to decide whether to trust a binary costs more than it
  buys. Two pages name Anthropic and both need to: the security page, because
  egress is where the reader needs the specific destination, and the install
  page, because `ANTHROPIC_API_KEY` is a variable somebody has to type.
- **The site is not the README.** Prose is the last resort: a table, a labelled
  list or the tool's own output says it in fewer words and is scannable. The
  overview page runs about 130 words of prose — headings and paragraphs, not
  the terminal frames or the panel — and should not grow.
- **The overview makes two arguments and no more**: no venue sees the whole
  position, and you can ask about it in plain English. Each shows rather than
  says — three venues each holding part of one asset, and tula answering the
  README's own question. The first is a two-column row, because a four-row
  table does not want the page's full width; the second puts its prose above a
  frame that takes all of it, because half a column is narrower than any
  terminal it would be read in. A third argument belongs on its own page.

## Distribution

The install path is part of the security product: someone runs it immediately
before pasting keys tied to their net worth.

- **A manual run is a dry run.** `workflow_dispatch` defaults `publish` to
  false, because `GITHUB_REF_TYPE` is `branch` there and the tag-matches-version
  check cannot protect it — without the gate a manual run would cut a real
  release from whatever was on the branch. A pre-release tag (`v0.4.0-rc.1`)
  exercises the real channels without touching the stable ones.
- **One tag produces every artifact.** `.github/workflows/release.yml` checks the
  tag against `src/version.ts`, runs `bun run check`, cross-compiles
  darwin/linux × arm64/x64 with Bun, signs the macOS binaries when Apple
  credentials are configured, attests every archive, then publishes to GitHub
  Releases, npm and the Homebrew tap. Any failing step fails the release.
- **Attestation, not a signing key.** GitHub artifact attestations are
  sigstore-backed and keyless, so this project has no key to generate, publish,
  rotate or lose. `install.sh` verifies one and **refuses** on failure; without
  the GitHub CLI it verifies the checksum and says plainly that provenance was
  not proven. Never soften that to a warning.
- **The origin is hardcoded in `install.sh` on purpose.** An environment variable
  that redirects the download is exactly the injection the script exists to
  prevent, which is why `install-test.sh` fakes the network with a `curl` shim on
  PATH instead of adding an override.
- **Artifact names are a contract** between `release-build.sh`, the formula, the
  npm packages and the installer. `guard.sh` fails the build when they drift,
  because the symptom is a release nobody can install and it only appears after
  a tag is pushed.
- **Never document an install path that does not work yet.** A published command
  that fetches nothing is an impersonation surface, not a convenience.

### Before the first release

None of this lives in the repository, and each missing piece fails a different
channel at a different moment. The tap and the npm scope fail *after* the GitHub
release is already public, while the site is telling people to use them.

| What | Why it blocks | Check |
|---|---|---|
| `hsnice16/homebrew-tap` exists, public | the job pushes to it; users clone it anonymously | `gh repo view hsnice16/homebrew-tap` |
| The npm token is `hsnice16`'s | the packages publish under that account's own scope | `npm whoami` |
| `HOMEBREW_TAP_TOKEN`, `NPM_TOKEN` | pushing the formula, publishing | `gh secret list` |
| `PUBLISH_HOMEBREW`, `PUBLISH_NPM` = `true` | both jobs are skipped without them | `gh variable list` |
| GitHub Pages enabled | the site serves `install.sh` | `gh api repos/hsnice16/tula/pages` |
| `APPLE_*` secrets | optional; without them macOS ships unsigned | `gh secret list` |

Set each variable last, after its token exists: `true` without the token turns a
skipped job into a failed one, and it fails after the GitHub release is public.

The tap starts empty: the job creates `Formula/` and the first commit on `main`
itself, so seeding it by hand is not a step.

Packages publish under `@hsnice16` because `@tula` belongs to another account,
as does the unscoped `tula`. Neither `npm org ls` nor `npm access list packages`
would have told you: the first prints an empty table for a scope you are not in,
and the second resolves the name as an account, so it succeeds for anybody's.
The scope list on npm's token page is the answer — it offers only what you can
publish to.

npm publishes from a token, so account 2FA never gates CI. `auth-only` is
therefore free — `npm profile enable-2fa auth-only` — and worth having: without
it a password is enough to publish `@hsnice16/tula`, which is the one entrance this
project's supply-chain argument would not cover.

`gh` is also what verifies an attestation, so a maintainer who cannot run
`gh attestation verify` cannot check the first release the way the install page
tells everyone else to.

### Cutting one

`scripts/release-cut.sh` does every edit a release needs and stops before the
tag, because the tag is the irreversible step and the only one worth taking by
hand. Read the `[Unreleased]` section first: whatever stands there becomes the
release's own section verbatim, prose included, and text written while nothing
was tagged reads wrong the moment something is.

```bash
bun run release:cut 0.2.0   # bumps every file stating the version, dates the changelog, runs the gate
```

Then commit, push, wait for CI on that commit, and push the tag — the script
prints all four commands with the version filled in. A `workflow_dispatch` run
with `publish` off first costs nothing and exercises everything but publishing.

## Pre-commit checks

```bash
bun run prepare-hooks  # once per clone: points git at .githooks
bun run check          # typecheck + tests + install test + guard + guard-test
bun run guard          # the SECURITY.md promises, enforced, and proof they still are
```

Hooks are a shell script under version control rather than a hook-runner
dependency: the whole gate is one command that takes about two and a half
seconds, so there is nothing to schedule in parallel or scope by glob, and this
repository argues its near-empty dependency list on supply-chain grounds.

`scan-staged` reads the staged *diff*, not the working tree — `git add -p` can
stage a hunk the file no longer shows. Its patterns are deliberately narrow: one
that fires on ordinary code teaches people to pass `--no-verify`, which is worse
than no hook at all.
