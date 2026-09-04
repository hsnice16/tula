import { DESCRIPTION, INSTALL_COMMAND, NAME, NAV, pageUrl, REPO, SITE } from '@/lib/site'

// Static export: this is written once at build time, like every page beside it.
export const dynamic = 'force-static'

/**
 * The llms.txt convention — one Markdown file an assistant can read instead of
 * scraping three pages of layout. It states what tula is and where to read the
 * rest; the promises themselves stay on `/security`, which is the page the
 * build checks. A second copy of a security claim is the copy that goes stale,
 * and this file is not the one anybody would think to update.
 */
export function GET(): Response {
  const pages = NAV.map(
    ({ href, label, blurb }) => `- [${label}](${pageUrl(href)}): ${blurb}`,
  ).join('\n')

  const body = `# ${NAME}

> ${DESCRIPTION}

You are long ETH spot on one exchange, short ETH perp on another, and holding ETH
as collateral against a debt on a lending protocol. Each venue is right about its
own piece and blind to the other two. tula reads all of them and answers the two
questions none of them can: **what is my real exposure**, and **what breaks
first**. Every figure is computed in plain code; a language model orchestrates
and narrates, and never does the arithmetic.

## What it reads

Hyperliquid (perps with liquidation price, spot, margin), Aave v3 on Ethereum
(collateral, debt and health factor), and an Ethereum wallet's ETH and ERC-20
balances — all three from a public address alone. Then Kraken, Binance, Coinbase
Advanced, Stripe and Circle Mint, each from a read-only key. A key that can
withdraw is refused rather than warned about.

## Commands

- \`exposure\` — net exposure per asset across every venue, with notional and the venues that contributed
- \`breaks\` — everything that can be liquidated, nearest first, with the move required to get there
- \`shock <ASSET> <PCT>\` — reprice the whole book and report what changes and what liquidates
- \`venues\` — per-venue counts, freshness and failures

A slash means a command; anything else is a question, answered in plain English
over the same vocabulary. Every command still works without a model key.

## Install

\`\`\`sh
${INSTALL_COMMAND}
\`\`\`

Also \`brew install hsnice16/tap/tula\` and \`npm install -g @hsnice16/tula\` — the same
binary. macOS and Linux, 64-bit Intel and ARM; Windows through WSL. Every release
carries a published checksum, which the installer always checks and refuses on,
and a sigstore-backed build attestation, which it checks wherever the GitHub CLI
is installed and signed in to read one.

## Pages

${pages}
- [Sitemap](${SITE}/sitemap.xml): every URL this site publishes

## Source

- [Repository](${REPO}): MIT-licensed, open from the first commit — the only way anyone can check the claims above
- [Security policy](${REPO}/blob/main/SECURITY.md): what is in scope and how to report privately
- [Changelog](${REPO}/blob/main/CHANGELOG.md) and [roadmap](${REPO}/blob/main/ROADMAP.md): read in the repository, where they are written
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
