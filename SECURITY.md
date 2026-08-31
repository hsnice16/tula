# Security policy

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/hsnice16/tula/security/advisories/new).
Do not open a public issue.

Expect an acknowledgement within 72 hours. Please give us 90 days before public
disclosure, or less if the issue is being exploited.

## What is in scope

tula is read-only and non-custodial, so the interesting failures are about
credentials and about lying to the user, not about stolen funds.

Highest severity first:

1. **Any path by which a credential leaves the machine**, other than to the venue
   it belongs to — logs, crash reports, telemetry, error messages, or a request
   to the model provider. The agent layer cannot import the secret store or a
   connector, and `scripts/guard.sh` fails the build if that ever changes.
2. **Any path that could place an order or move funds.** There should be none.
3. **A key that can trade or withdraw being accepted** by `connect`.
4. **Credentials written outside `~/.config/tula` or at a mode wider than 600.**
5. **Prompt injection through venue-supplied text** — token names, memo fields,
   NFT metadata, protocol descriptions — that changes what tula reports or
   where it sends data.
6. **A wrong risk number presented as correct**: a liquidation distance, health
   factor or net exposure that is silently incorrect, or a stale figure rendered
   as live. This is a security issue here, not just a bug — people size positions
   on these numbers.

## Supply chain

Dependencies are pinned to exact versions and `bun.lock` is committed, so a
published version cannot change under a build. CI installs with
`--frozen-lockfile`. The runtime dependency list is deliberately near-empty and
all I/O uses Node built-ins; a dependency here runs in a process that reads
exchange API keys.

## Out of scope

- Vulnerabilities in a venue's own API.
- A user who pastes a key with trade or withdraw permissions into a *different*
  tool.
- Missing rate limiting against a venue you authenticate to yourself.

## What tula will never do

If you observe any of these, treat the binary as compromised and report it:

- Ask for a seed phrase, private key, or exchange password.
- Send a credential anywhere except the venue it belongs to.
- Place, modify or cancel an order.
- Send your positions anywhere you did not ask it to.

## Where your data goes

Two destinations, both of which you choose:

- **The venues you connect, and the price source.** Nothing else is contacted to
  build the view.
- **Anthropic, and only when you ask a question in plain English.** Answering one
  means sending the computed figures — assets, quantities, notional values,
  liquidation distances, venue names — as tool results. Credentials are never
  among them, by construction. Every command works without a model and sends
  nothing to Anthropic; if you never ask a question, tula never talks to it.

## Verifying a release

Every release archive carries a GitHub artifact attestation — sigstore-backed and
keyless, so there is no signing key for this project to generate, publish, rotate
or lose.

```bash
gh attestation verify tula-v0.3.0-darwin-arm64.tar.gz --repo hsnice16/tula
```

The installer runs this automatically when the GitHub CLI is present and refuses
to install on failure. Without it, the installer still verifies the published
checksum, says plainly that provenance was **not** proven, and prints the command
above — a checksum served beside the artifact only proves the file is intact,
since whoever could replace one could replace both. `TULA_REQUIRE_ATTESTATION=1`
turns the missing check into a refusal.

tula is installed from `https://hsnice16.github.io/tula/install.sh` and published from
`github.com/hsnice16/tula`, and nowhere else. Anything you cannot verify against
that repository did not come from this project.
