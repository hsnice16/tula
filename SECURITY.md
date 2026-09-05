# Security policy

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/hsnice16/tula/security/advisories/new).
Do not open a public issue.

tula is maintained by one person, so there is no on-call rota to promise you.
Expect a reply as soon as it is read, usually within a week. If a week passes
with nothing, assume it was missed rather than ignored, and say so on the same
advisory.

Please allow 90 days before public disclosure, or less if the issue is being
exploited — and less still if I have gone quiet.

## What is in scope

tula is non-custodial, and read-only for the moment — placing trades will come
later, and moving funds will not. So the interesting failures are about
credentials and about lying to the user, not about stolen funds.

Highest severity first:

1. **Any path by which a credential leaves the machine**, other than to the venue
   it belongs to — logs, crash reports, telemetry, error messages, or a request
   to the model provider. The agent layer cannot import the secret store or a
   connector, and `scripts/guard.sh` fails the build if that ever changes.
2. **Any path that could move funds off a venue.** There should be none, ever.
   Any path that places an order: none today either — placing trades will come
   later, and a build that does it before then is compromised.
3. **A key that can withdraw being accepted** by `connect`. A key that can trade
   is refused today too, wherever the venue will say so.
4. **Credentials written outside `~/.config/tula` or at a mode wider than 600**,
   or read through a link or out of a directory anyone can write to. The file is
   deliberately not encrypted — a key beside the ciphertext protects nothing and
   a passphrase breaks unattended commands — so its permissions are the whole
   defence, and a hole in them is a real finding.
5. **Prompt injection through venue-supplied text** that changes what tula
   reports or where it sends data. The surface is small and worth knowing
   exactly, because every one of them is drawn on screen *and* returned to the
   model as a tool result:

   - An asset symbol — as each venue's own listing spells it, or as an Aave
     reserve contract returns it over whichever Ethereum RPC is configured.
     Every one is capped at 32 characters and stripped of control characters as
     it enters, in `src/cli/session.ts`; `src/connectors/evm.ts` caps its own
     decode as well, so a lying ABI length prefix is never allocated.
   - The text of a venue's error, when one fails. Capped at 200 characters and
     flattened to a single line, in the same file, so it cannot pose as a
     second message.

   No memo, NFT metadata or protocol description is read at all.
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

- Ask for a seed phrase or an exchange password. (Coinbase's CDP API key is a
  private key, and the only one tula ever loads; it signs read requests and
  cannot move funds.)
- Send a credential anywhere except the venue it belongs to.
- Move funds off a venue.
- Place, modify or cancel an order — until trading ships, which will be
  announced, opt-in, and confirmed by you per trade. A build that does it
  silently is compromised.
- Send your positions anywhere you did not ask it to.

## Where your data goes

Everything tula contacts, and nothing else:

- **The venues you connect, and the price source you chose.**
- **A public Ethereum RPC and a token list**, for the on-chain venues. These are
  defaults rather than choices — `https://ethereum-rpc.publicnode.com` and
  `https://tokens.uniswap.org` — and each sees the address you are reading.
  `TULA_ETH_RPC` and `TULA_TOKEN_LIST` point them elsewhere, including at your
  own node.
- **Anthropic, and only when you ask a question in plain English.** Answering one
  means sending the computed figures — assets, quantities, notional values,
  liquidation distances, venue names — as tool results. Credentials are never
  among them, by construction. Every command works without a model and sends
  nothing to Anthropic; if you never ask a question, tula never talks to it.

- **GitHub, to see whether there is a newer release.** Once a day at most, and
  only in the interactive shell. It is a GET of the public
  `/releases/latest` page, carrying nothing about you — not your version, not an
  identifier, no query string — so what GitHub sees is what it sees from anyone
  opening that page. `TULA_NO_UPDATE_CHECK=1` stops it. Nothing is ever
  installed by that check: it prints a line, and `/update install` is a separate
  thing you type. Typing it fetches the release archive and `checksums.txt` from
  the same repository, and nothing else. That is the only other request, and
  only when you ask for it.

No telemetry and no crash reporting. The update check is the only request the
binary makes that is not about your positions, and it is the only one that
reports nothing.

## Verifying a release

Every release archive carries a GitHub artifact attestation — sigstore-backed and
keyless, so there is no signing key for this project to generate, publish, rotate
or lose.

```bash
gh attestation verify tula-v0.1.0-darwin-arm64.tar.gz --repo hsnice16/tula
```

The subject is the archive, not the binary inside it, so verify the `.tar.gz`
rather than an installed `tula`. Homebrew downloads that same archive. npm
repackages the binary into a tarball of its own, which this attestation does not
cover: that channel is published with `npm publish --provenance` and is checked
with `npm audit signatures` instead.

The installer runs this automatically when the GitHub CLI is present and signed
in, and refuses to install on failure. Without either, it still verifies the
published checksum, says plainly that provenance was **not** proven, and prints
the download and the verify command — a checksum served beside the artifact only
proves the file is intact, since whoever could replace one could replace both.
`TULA_REQUIRE_ATTESTATION=1` turns the missing check into a refusal.

tula is built by `github.com/hsnice16/tula` and published to its install page,
Homebrew and npm — one binary, built once. Anything you cannot verify against
that repository did not come from this project.
