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
bun run check          # typecheck + tests + install test + guard — what CI runs
```

`prepare-hooks` sets `core.hooksPath`, so `.githooks/pre-commit` runs the same
gate CI does — about two and a half seconds — plus a scan of staged content for
anything key-shaped. That scan is the one check whose failure cannot be undone
by a later commit: once a key is in history, rotating it is the only remedy.
A published vendor test vector or a public contract address goes in
`.githooks/allowed-secrets`, with the reason it is not a secret. `--no-verify`
bypasses the hook; CI runs the same commands regardless.

Never point a scratch run at your real credential store:

```bash
export TULA_CONFIG_DIR=/tmp/tula-try
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
  including test fixtures and pasted output.

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
7. **Language that reads as a toy.** No "demo", "dummy", "fake", "toy" or
   "playground" in anything a user sees. `scripts/guard.sh` fails the build on it.
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

One tag produces every artifact. `.github/workflows/release.yml` verifies the tag
against `src/version.ts`, runs the full check, cross-compiles the four targets,
signs the macOS binaries when Apple credentials are configured, attests every
archive, then publishes to GitHub Releases, npm and the Homebrew tap. Any failing
step fails the release; nothing is published half-done.

```bash
bash scripts/release-build.sh dist/release   # the same artifacts, locally
bash scripts/install-test.sh                 # runs install.sh against a fake release
bash scripts/npm-pack.sh dist/release        # the npm tree that would be published
bash scripts/homebrew-formula.sh dist/release tula   # the formula, real checksums
```

### Testing a release

Two ways, neither of which publishes anything by accident.

**A dry run of the workflow.** Actions → Release → *Run workflow*, leaving
`publish` off. It builds all four targets, signs, verifies, runs the installer
against them and attests — then stops, and leaves the artifacts and
`checksums.txt` on the run to inspect. Publishing is off by default because
`GITHUB_REF_TYPE` is `branch` on a manual run, so the tag-matches-version check
cannot protect it; without the gate, a manual run would cut a real release from
whatever was on the branch.

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
