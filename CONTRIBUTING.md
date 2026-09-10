# Contributing

Same rules as [AGENTS.md](./AGENTS.md), phrased for a PR workflow. Read that file
for architecture and conventions; this one covers process.

## Setup

Needs [Bun](https://bun.sh) and **Node 22** (`.nvmrc`, `nvm use`). Node is only
there to run `tsc`, but TypeScript will not start on 18 — it fails inside node's
module loader with a stack trace that names neither the cause nor the fix. Users
install a prebuilt binary and need none of this.

```bash
git clone https://github.com/hsnice16/tula && cd tula
bun install
bun run prepare-hooks  # points git at .githooks — do this once
bun run build          # -> dist/tula
bun run check          # typecheck, tests, install path, guards — CI runs each of these, and more
```

`prepare-hooks` sets `core.hooksPath`, so `.githooks/pre-commit` runs the same
gate CI does — the whole of `bun run check` — plus a scan of staged content for
anything key-shaped. That scan is the one check whose failure cannot be undone
by a later commit: once a key is in history, rotating it is the only remedy.
A published vendor test vector or a public contract address goes in
`.githooks/allowed-secrets`, with the reason it is not a secret — a 64-character
hex string is the exception, because a private key has that shape and there is
no public value of it this repository needs. `--no-verify` bypasses the hook,
which is why CI stages the whole tree and runs the same scan; `scan-test.sh`
proves the patterns still catch what they claim to.

Every PR asks for a review from the code owner (`.github/CODEOWNERS`). That is a
requirement rather than a request only once *Require review from Code Owners* is
on for the branch; without the setting the file adds a reviewer and nothing more.

Never point a scratch run at your real credential store:

```bash
export TULA_CONFIG_DIR=/tmp/tula-try
export TULA_INSTALL_DIR=/tmp/tula-try-install  # /update install writes here, not ~/.tula
```

Wallet, Hyperliquid and Aave read from a public address, so you can exercise the
whole path with any address and no credentials at all.

## Before you open a PR

- `bun run check` passes.
- New behaviour has a test beside it as `*.test.ts`.
- No new runtime dependency unless it is genuinely unavoidable, and say why in
  the PR. This process reads exchange API keys; every dependency is a path in.
- Pin it to an exact version — no `^`, no `~` — and commit the lockfile change.
  Upgrades are their own commit, so the diff shows what moved.
- No credential, address, or balance from a real account anywhere in the diff —
  including test fixtures and pasted output. A captured fixture keeps the venue's
  shapes and the venue's arithmetic and none of its amounts:
  `scripts/capture-onchain.ts` stands a placeholder in for each address and
  multiplies every amount by one factor per account, drawn at capture time and
  recorded nowhere — a factor anyone can read divides straight back out to the
  real balance. What the venue relates is degree one in those amounts and holds
  exactly after the multiplication; a rounded or invented figure relates nothing,
  and a fixture that states no arithmetic can only ever agree with whatever the
  connector already believed.
- A new module is listed in the AGENTS.md layout, and anything that changed
  behaviour is reflected in `README.md` and `CHANGELOG.md`. `guard.sh` fails on
  a module nobody documented; a doc describing what the code used to do is
  worse than no doc at all.
- Anything touching the shell was **run**, not just compiled. A terminal UI has
  failure modes no test sees — a frame taller than the viewport, a row that
  wraps where the layout counted one. Open it and look at the screen.

## The rules that will get a PR rejected

These are not style preferences.

1. **A code path that can place an order or move funds.** Including "validate
   only" order endpoints. The absence is the product.
2. **A prompt for a seed phrase or private key.** On-chain reads take a public
   address.
3. **Anything that widens access to `src/secrets/store.ts`.** The command layer
   and connectors read it; the agent layer never may.
4. **Collapsing an unknown into a default.** `KeyScope.canTrade` is `'unknown'`
   when unprovable, `NetExposure.notional` is `null` without a price. A confident
   wrong answer is worse than an admitted gap.
5. **A rendered figure without its `asOf`.** Freshness is a safety feature.
6. **`number` for a quantity or price.** `decimal.js`, always.
7. **Language that reads as a toy.** No "demo", "dummy", "fake", "toy",
   "playground", "just a test" or "for now" in anything a user sees.
   `scripts/guard.sh` fails the build on it.
8. **A dead end with no way out.** Every error and every empty state names the
   next step — the command to run, the kind of key to make, the link to the
   venue's own page. See "What the user reads" in [AGENTS.md](./AGENTS.md).

## Adding a connector

The most useful contribution. See "Adding a connector" in [AGENTS.md](./AGENTS.md).

A connector PR should include the venue's asset-naming oddities as unit tests —
those are where silent wrong answers come from, and they are cheap to pin.

If the venue cannot prove a key's scope, return `'unknown'` and say so in the
connect output. Do not probe by mutating state.

## Releasing

One tag produces every artifact. `.github/workflows/release.yml` waits on the
`release` environment for a reviewer, refuses a tag that is not an ancestor of
`main` — the attestation names this workflow by path, so a tag off main would
prove only that some version of the file ran — verifies the tag against
`src/version.ts`, runs the full check, cross-compiles the four targets, signs the
macOS binaries where Apple credentials are configured, attests every archive,
then publishes to GitHub Releases, npm and the Homebrew tap.

A failing step fails the release, but npm and Homebrew are separate jobs behind
`vars.PUBLISH_NPM` and `vars.PUBLISH_HOMEBREW`, and an unset one **skips rather
than fails**: the GitHub release is already published and correct, and a missing
token is a setup gap rather than a bad build — the same tag can be re-run once it
exists. A skipped job looks exactly like a green release while the install page
goes on telling people to use that channel, so the run prints a warning naming
each channel that is off. Read it before you announce anything.

```bash
bash scripts/release-build.sh dist/release   # the same artifacts, locally
bash scripts/install-test.sh                 # runs install.sh against a fake release
bash scripts/npm-pack.sh dist/release        # the npm tree that would be published
bash scripts/homebrew-formula.sh dist/release tula   # the formula, real checksums
```

### Testing a release

Two ways, neither of which publishes anything by accident.

**A dry run of the workflow.** Actions → Release → *Run workflow*, leaving
`publish` off. It builds all four targets, verifies them and runs the installer
against them — then stops, and leaves the artifacts and `checksums.txt` on the
run to inspect. It signs only where `secrets.APPLE_CERT_P12` is set; without it
the macOS binaries are unsigned and the run says so. Publishing is off by default
because `GITHUB_REF_TYPE` is `branch` on a manual run, so the tag-matches-version
check cannot protect it; without the gate, a manual run would cut a real release
from whatever was on the branch. **It does not attest.** That step is gated with
the publish steps rather than run beside them: an attestation is a public
transparency-log entry, and `install.sh` pins the signing workflow but not the
ref it ran from — so a dry run from any branch would mint proof that a build off
that branch came from this workflow, indistinguishable from a release at the only
place anybody checks.

**A pre-release tag,** when you want the real channels exercised. Set
`APP_VERSION` to something like `0.4.0-rc.1` and push `v0.4.0-rc.1`: the GitHub
release is marked pre-release, npm publishes under the `next` tag, and Homebrew
moves only `tula-latest`, never stable. `install.sh` still resolves `latest` to
the newest *stable* release, so a pre-release reaches only people who ask for it
by name with `TULA_VERSION`.

The stable Homebrew formula lags on purpose: a plain tag promotes it, a
pre-release tag moves only `tula-latest`. A build found to be wrong is skipped by
promoting the next one instead of it. Here that lag is worth more than for a
coding tool — a bad build does not fail loudly, it shows someone a wrong
liquidation number.

## Commits

Explain why, not what. The diff already says what.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](./SECURITY.md).
