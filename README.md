# tula

**Your true exposure, what breaks first, and more, across every venue at once.**

[![CI](https://github.com/hsnice16/tula/actions/workflows/ci.yml/badge.svg)](https://github.com/hsnice16/tula/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Non-custodial, and read-only for the moment — placing trades will come later;
moving funds will not.

The name is taken from Sanskrit: **tula**, the balance. The scale that weighs one
side against the other, and the same object Latin calls *Libra*.

Crypto and fiat: Hyperliquid, Aave, Kraken and Binance sit beside Stripe, because
a business's settled balance is part of the same picture as its positions.

## The idea

You are long ETH spot on Kraken, short ETH perp on Hyperliquid, and holding ETH as
Aave collateral against USDC debt.

**What is your actual ETH exposure? What breaks first if ETH drops 20%?**

Kraken cannot tell you — it sees Kraken. Hyperliquid sees Hyperliquid. Aave sees a
health factor and nothing either side of it. Portfolio trackers show balances,
which is not the same as risk. And no venue will ever build this, because
aggregating a user's positions across competitors is against its interest.

That gap is the product. Every venue weighs only what it holds. Nothing weighs
both sides of a position that spans them.

## Prior art + what we do differently

| | What it is | What it does not do |
|---|---|---|
| [Kraken CLI](https://github.com/krakenfx/kraken-cli), Binance Agent OS, OKX Agent Trade Kit | Exchange-native agent CLIs, free and well built | Each knows one venue. None will ever manage your Aave health factor |
| DeBank, Zerion, Zapper | On-chain portfolio views | Balances, not risk. No CEX side, no liquidation math, no scenarios |
| Bitsgap, goodcryptoX | No-code bots across CEXs and perp DEXs | Template bots in a web GUI; no unified risk, no lending |
| [TradingAgents](https://github.com/TauricResearch/TradingAgents), AI Hedge Fund | LLM reasoning over markets | Signals and analysis, not your positions |
| Bloomberg ASKB | Conversational AI in the Terminal | Not for crypto, not for you |

**What we do differently:** one canonical position model spanning CEX spot, perp
DEX margin and lending collateral, so a single asset held three ways nets to one
number with one liquidation answer. Nobody spans those three domains, and the
incumbents are structurally unable to.

## Honest product concerns

- **The integration treadmill kills aggregators.** Mitigated by two tiers: hand-build
  only venues that need real liquidation math, and cover the long tail with one
  portfolio-aggregator API. Not eliminated.
- **Read-only limits how much we can help.** We can tell you your health factor
  breaks in an hour; we cannot fix it. Execution is 2.0, and deliberately last.
- **The data is the risk.** An aggregated view of one person's entire net worth is
  valuable to an attacker even though it moves nothing. See
  [Security posture](#security-posture).
- **Price disagreement is real.** Kraken and an on-chain oracle will not match to
  the basis point. We use one oracle for the whole process rather than mixing
  quotes, which makes the number consistent — not perfect.
- **Nobody has asked for this yet.** The wedge is reasoned, not validated.

## Security posture

tula is non-custodial, and read-only for the moment — placing trades will come
later. No code path can move funds off a venue, and none places an order today;
`scripts/guard.sh` fails the build if one appears, and `scripts/guard-test.sh`
proves that check still catches one.

- **It never asks for a seed phrase.** On-chain positions are read from public
  addresses. Anything prompting you for a seed phrase while claiming to be tula
  is not tula. The one private key tula loads is a Coinbase CDP API key, which
  signs read requests and cannot move funds; the guard fails if key handling
  appears in any other file.
- **Credentials are not encrypted at rest.** One file, `~/.config/tula/credentials.json`,
  mode 600, plain JSON, refused if it is a link or if anything else can write to
  its directory. A key kept beside the ciphertext would protect nothing and a
  passphrase would break the unattended commands, so the choice is stated rather
  than dressed up.
- **Exchange API keys must be query-only.** Scope is verified against the venue at
  connect time; a key that can withdraw is refused, not warned about.
- **Where a venue cannot prove scope, we say so.** Kraken proves a key cannot
  withdraw — the endpoint gated on that permission reads without moving
  anything, so a refusal is the proof. Nothing proves it cannot *trade*: every
  trade-gated endpoint places or mutates an order. Trade is the permission tula
  reports as *unknown*, rather than implying a check that did not happen.
- **A venue with no read-only key is not a venue tula offers.** Unproven is one
  thing; a credential every one of whose forms can move money is another, and no
  wording on a connect screen makes it safe to store. Circle Mint was dropped for
  exactly this — a Mint key can create payouts and transfers, and Circle publishes
  no way to make one that cannot.
- **Credentials stay on your machine**, at `~/.config/tula/credentials.json`,
  mode 600 enforced on every read, and are sent only to the venue they belong to.
- **Credentials never enter model context.** The agent layer sees one interface —
  the risk engine — and cannot import a connector or the secret store. That is
  enforced by `scripts/guard.sh` in CI, not by convention.
- **The model never computes a number.** Every figure it reports was calculated by
  deterministic code and handed to it, already rounded and formatted by the same
  code that draws the tables. It has no raw value to re-round, so the sentence it
  writes and the row on screen cannot disagree.
- **Text tula did not write is bounded.** Two kinds of string reach the screen
  and the model from outside: an asset symbol — as a venue's listing spells it,
  as the configured token list names it, or as an Aave reserve contract returns
  it — and the error text of a venue or a price source when one fails. Both are
  capped and flattened to a single line, so neither can pose as an instruction,
  and every tool result names the paths they sit at — so what
  marks them as data is the payload rather than a sentence in a prompt the model
  has to keep. A name that had to be cleaned is said out loud too: an `ALTERED`
  line names the venue that sent it and the node variable that chooses who
  answers for a chain, never the string itself. A read-only tool can still be
  talked into lying to you about a health factor.

Network egress is the venues you connect, the price source you chose, a public
node on each chain read — Ethereum, Arbitrum One and Base — and a token list for
the on-chain venues, GitHub once a day from the interactive shell to see whether
there is a newer release — and, only when you ask a question in plain English,
Anthropic, which receives the computed figures and never a credential.
Drive tula with commands and it never talks to a model at all.
[SECURITY.md](./SECURITY.md) lists each one and what it sees.

- **The install path is checked, not trusted.** Every release carries a
  sigstore-backed build attestation. Where the GitHub CLI is present and signed
  in, the installer checks it and stops if that fails; where it is not, it
  verifies the checksum and says plainly that provenance was not proven.
  `TULA_REQUIRE_ATTESTATION=1` makes the unproven case a refusal. There is no
  signing key for this project to lose.

Report a vulnerability: [SECURITY.md](./SECURITY.md). The canonical page to check
before trusting a binary is the [security model](https://usetu.la/security/).

## Install

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://usetu.la/install.sh | sh
```

```bash
brew install hsnice16/tap/tula     # or: npm install -g @hsnice16/tula
```

macOS and Linux, on 64-bit Intel and ARM. Alpine and other musl systems are not
supported, and there is no native Windows build — install inside WSL. The
installer always checks the download against its published checksum, and checks
the sigstore-backed attestation proving this repository's release workflow built
it wherever the GitHub CLI can — saying so either way. Check one by hand:

```bash
gh attestation verify tula-v0.1.3-darwin-arm64.tar.gz --repo hsnice16/tula \
  --signer-workflow hsnice16/tula/.github/workflows/release.yml
```

Pin a version with `TULA_VERSION`, require provenance with
`TULA_REQUIRE_ATTESTATION=1`. Versions install side by side under
`~/.tula/versions` behind a symlink, so going back to one is a link flip.

Wallet, Hyperliquid and Aave read from a public address, so you can point tula at
any address — yours or a public one — and see live positions without handing it a
single credential:

```bash
tula          # / -> wallet -> connect -> paste any 0x address
```

On first run it offers to set up plain-English questions, and takes "no" for an
answer — every command works without a model. Type `/` for the command menu.

Building from source: [CONTRIBUTING.md](./CONTRIBUTING.md).

### Trying it

Point it at a public address first — Wallet, Hyperliquid and Aave need no
credential, so you can see the whole cross-venue path work before deciding
whether to trust it with a key. When you do connect an exchange, make the key
**query-only**; tula verifies that against the venue and refuses anything that
can withdraw.

Two things worth knowing before you report anything: never paste an API key into
an issue, and tula's output is a picture of your net worth — replace the numbers
or describe the shape. The
[issue templates](https://github.com/hsnice16/tula/issues/new/choose) say the
same at the point you need it. "I would not use this because…" is the most
useful thing you can send.

## Status

| Venue | Reads | Needs |
|---|---|---|
| **Wallet** (Ethereum, Arbitrum One and Base) | native ETH and ERC-20 balances off a token list, per chain | one or more public addresses |
| **Hyperliquid** | perp positions with liquidation price, spot, the account's USDC | one or more public addresses |
| **Aave v3** (Ethereum, Arbitrum One and Base) | collateral, debt, health factor, per asset, across six markets | one or more public addresses |
| **Kraken** | spot, staked and held balances in every wallet, and open margin positions with the loan behind each | one or more query-only API keys |
| **Binance** | spot balances with free and locked stated apart, and cross and isolated margin with the liquidation price each carries | one or more read-only API keys |
| **Coinbase Advanced** | every account the key can list, free and held stated apart, and perpetual positions with liquidation price and leverage | one or more CDP API keys (view-only) |
| **Stripe** | five of the six balance buckets `/v1/balance` carries, per currency — `instant_available` is a slice of `available` and would state the same money twice | one or more restricted (`rk_`) keys |

| | |
|---|---|
| Net exposure, scenarios, liquidation distance | working |
| More than one account per venue — a hot wallet and a cold one, two exchange keys | working; every figure counts all of them, each row carries the account it came from, and `INCOMPLETE` names the account that failed rather than only the venue |
| How much of a holding you can move, and what is holding the rest | working; a `FREE` and an `UNAVAILABLE` column where something is held, and an em dash where the venue reports too little to prove it |
| What tula never asked for | working; `/venues` names every area a connector declares it does not read, with what each may hide, and every one of them is scheduled work in [ROADMAP.md](./ROADMAP.md) |
| Interactive shell — slash commands, ctrl+k to search them, ctrl+o for long output, plain English | working; both command lists take the mouse as well as the keyboard |
| Prices — CoinGecko, CoinPaprika, CoinMarketCap, CryptoCompare | working; one active at a time, `/<source> use` switches |
| Staying current — the shell checks once a day and says so in a line; `/update` checks there and then | working; nothing is installed until you type `/update install` |
| Kraken's account margin level | planned — Kraken liquidates on an account-wide level and no position carries that figure, so those rows rank `unknown` until it is read |
| Binance futures | not while tula is read-only — Binance's futures permission grants trading, and a key holding it is refused |
| Solana | planned — a different RPC and account model, so a connector of its own rather than a registry entry ([`breadth/12`](./tasks/breadth/12-chain-reach.md)) |
| Hyperliquid's own EVM chain (HyperEVM) | planned — both legs or neither. A balance there is a HyperCore spot balance and an EVM ERC-20 scaled against each other, so one leg alone is a number that is not the holding ([`breadth/12`](./tasks/breadth/12-chain-reach.md)) |
| Aave V4 | planned — v4 is Hubs and Spokes rather than Pools, so no call the connector makes reaches it ([`breadth/08`](./tasks/breadth/08-aave-v4.md)) |
| Execution | not in v1 — see [ROADMAP.md](./ROADMAP.md) |

On a Kraken margin account the positions are read, but the margin level Kraken
would actually liquidate on is not, so those rows rank `unknown` rather than
carrying a distance.

## Stack & rationale

- **TypeScript + Bun**, compiled to a single binary with `bun build --compile`.
  One artifact, no runtime to install, and the same binary ships through every
  channel.
- **decimal.js everywhere.** Never `number` for money — a float rounding error in
  a liquidation distance is a wrong answer that looks right.
- **Node built-ins for all I/O.** Every dependency is a supply-chain path into a
  process that reads exchange keys, so the dependency list stays near zero.

## Versioning

`0.x` while the read-only risk view is finding its shape. `1.0` when it is
complete and trustworthy *without* an agent — if it is not useful alone, an agent
on top will not save it.

## Roadmap

Milestones and the order they are in, in [ROADMAP.md](./ROADMAP.md); the task
breakdown behind each in [`tasks/`](./tasks); shipped work in
[CHANGELOG.md](./CHANGELOG.md).

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md). Agents: [AGENTS.md](./AGENTS.md).

New venue connectors are the most useful contribution, and the one thing that
directly attacks the integration treadmill.

## License

MIT — see [LICENSE](./LICENSE).
