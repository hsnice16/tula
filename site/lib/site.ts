export const REPO = 'https://github.com/hsnice16/tula'

export const SITE = 'https://hsnice16.github.io/tula'

export const NAME = 'tula'

/**
 * GA4, for the site alone. Held here rather than read from `process.env`
 * because the Pages workflow sets no environment: an id that arrived that way
 * would build to nothing in CI and deploy a page with no tag at all, and
 * nothing would report the absence. It is public in the page source regardless.
 */
export const GA_MEASUREMENT_ID = 'G-14L4YMLWGV'

export const AUTHOR = { name: 'Himanshu Singh', url: 'https://github.com/hsnice16' } as const

/**
 * The site's one sentence, and the one the read-only caveat travels in —
 * `src/site-claims.test.ts` reads this file for it. Worded so trading can be
 * *added* later rather than so a promise is withdrawn, because a security
 * promise retracted on release day reads as though it was never true.
 */
export const DESCRIPTION =
  'A terminal tool that answers what no single venue can: what is my real exposure, and what breaks first? Non-custodial, and read-only for the moment — placing trades will come later.'

/**
 * The one string every install instruction on the site renders. Written out
 * rather than assembled, because the flags are the point: --proto '=https'
 * refuses an HTTP downgrade on redirect and -f fails instead of piping an
 * error page into a shell.
 */
export const INSTALL_COMMAND = `curl --proto '=https' --tlsv1.2 -LsSf ${SITE}/install.sh | sh`

/**
 * A route's published URL. `trailingSlash` in `next.config.ts` puts a slash on
 * every path, so a sitemap entry or a breadcrumb without one names a URL that
 * redirects to the real one.
 */
export const pageUrl = (href: string) => `${SITE}${href === '/' ? '' : href}/`

/**
 * Every route the site publishes, in the order the header shows them. The
 * header, the footer, the sitemap and `llms.txt` all take the routes from here,
 * so a fourth page cannot ship unlinked or unindexed; the blurb is the sentence
 * `llms.txt` summarises each one by.
 */
export const NAV = [
  {
    href: '/',
    label: 'Overview',
    blurb:
      'What one asset held spot, short and pledged nets to, what breaks first, and the question you can ask in plain English instead.',
  },
  {
    href: '/install',
    label: 'Install',
    blurb:
      'One command. Checksum and sigstore attestation, what it runs on, Homebrew and npm, and how to go back to a version.',
  },
  {
    href: '/security',
    label: 'Security',
    blurb:
      'What tula promises about your credentials and your funds, what enforces each promise in the build, and where the edges are.',
  },
] as const

/**
 * Named and referenced by hand rather than through Next's `opengraph-image`
 * convention, which exports the file with no extension at all. GitHub Pages
 * serves that as a byte stream, and every card crawler drops a picture whose
 * content type is not an image — the one failure that is invisible from the
 * site itself.
 */
export const OG_IMAGE = {
  url: '/og.png',
  type: 'image/png',
  width: 1200,
  height: 630,
  alt: `${NAME} — one asset held three ways, netted, with the move that liquidates it`,
} as const

/** Spread by every page, so a card is never the one thing a new page forgets. */
export const OG = { locale: 'en_US' as const, siteName: NAME, images: [OG_IMAGE] }

export const TWITTER = { card: 'summary_large_image' as const, images: [OG_IMAGE] }

/**
 * Two audiences, one list: the venue and risk vocabulary somebody types into a
 * search box, and the names of the things tula reads. Terms nothing on the site
 * can back up are not here — a keyword tula does not answer for is a search it
 * loses on arrival.
 */
export const KEYWORDS = [
  'tula',
  'crypto',
  'defi',
  'trading',
  'terminal',
  'cli',
  'tui',
  'crypto cli',
  'crypto tui',
  'terminal ui',
  'command line',
  'single binary',
  'open source',
  'self hosted',
  'macos',
  'linux',
  'crypto portfolio',
  'portfolio tracker',
  'crypto portfolio tracker',
  'portfolio aggregator',
  'crypto dashboard',
  'defi dashboard',
  'unified portfolio',
  'cross exchange',
  'cross venue',
  'multi exchange portfolio',
  'portfolio risk',
  'risk management',
  'crypto risk',
  'risk engine',
  'net exposure',
  'true exposure',
  'delta exposure',
  'net delta',
  'position netting',
  'liquidation',
  'liquidation price',
  'liquidation risk',
  'liquidation calculator',
  'distance to liquidation',
  'health factor',
  'margin call',
  'what breaks first',
  'stress test',
  'scenario analysis',
  'shock test',
  'portfolio stress test',
  'perp',
  'perps',
  'perpetual futures',
  'perp dex',
  'margin',
  'leverage',
  'collateral',
  'cex',
  'dex',
  'lending protocol',
  'money market',
  'kraken',
  'hyperliquid',
  'aave',
  'aave v3',
  'binance',
  'coinbase',
  'coinbase advanced',
  'stripe',
  'circle mint',
  'kraken api',
  'binance api',
  'hyperliquid positions',
  'aave health factor',
  'ethereum',
  'erc-20',
  'onchain',
  'wallet balances',
  'public address',
  'token list',
  'coingecko',
  'non-custodial',
  'read only api key',
  'query only api key',
  'no seed phrase',
  'never a seed phrase',
  'self custody',
  'sigstore',
  'build attestation',
  'supply chain security',
  'reproducible install',
  'agentic',
  'ai agent',
  'agentic trading',
  'trading agent',
  'ai trading assistant',
  'natural language query',
  'claude',
  'claude opus',
  'anthropic',
  'llm terminal',
]
