export const REPO = 'https://github.com/hsnice16/tula'

export const SITE = 'https://usetu.la'

export const NAME = 'tula'

/**
 * What the hero's frame prints in its banner, restated here because the site is
 * a separate package and cannot import `src/version.ts`. `guard.sh` fails when
 * the two disagree and `release-cut.sh` bumps this with them: a frame offered
 * as the tool's own output cannot print a release that was never cut.
 */
export const VERSION = '0.4.2'

/**
 * GA4, for the site alone. Held here rather than read from `process.env`: an
 * id that arrived that way and went missing would deploy a page carrying no tag
 * at all, and nothing would report the absence. It is public in the page source
 * regardless, so an env var buys no secrecy to trade against that.
 */
export const GA_MEASUREMENT_ID = 'G-14L4YMLWGV'

/**
 * Search Console ownership. It stays after the property verifies: Google
 * re-checks the tag periodically and un-verifies the property when it goes,
 * which takes the sitemap and the index coverage with it. Not an env var, for
 * the same reason the measurement id is not.
 */
export const GOOGLE_SITE_VERIFICATION = '_P43RYmlEi0KfBDT9dPH3lI6PhGLWZE-OIIzl0ieHws'

export const AUTHOR = { name: 'Himanshu Singh', url: 'https://github.com/hsnice16' } as const

/**
 * The site's one sentence, and the one the read-only caveat travels in —
 * `src/site-claims.test.ts` reads this file for it. Worded so trading can be
 * *added* later rather than so a promise is withdrawn, because a security
 * promise retracted on release day reads as though it was never true.
 */
export const DESCRIPTION =
  'Open-source CLI: exposure and liquidation risk on Hyperliquid, Aave, Kraken, Binance, Coinbase, Stripe and wallets. Read-only; placing trades will come later.'

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
 * Every route the site publishes, in display order. The footer, the sitemap and
 * `llms.txt` all take the routes from here, so a new page cannot ship unlinked
 * or unindexed; the header shows only `inHeader` ones. `group` picks the
 * footer's Pages or a guide `shelf`; `under` lists a page beneath another
 * there, by its `footerLabel`. The blurb is what `llms.txt` summarises it by.
 */
export const NAV = [
  {
    href: '/',
    label: 'Overview',
    inHeader: true,
    group: 'site',
    blurb:
      'How one asset held spot, short and as collateral nets out, what breaks first, and asking in plain English instead.',
  },
  {
    href: '/install',
    label: 'Install',
    inHeader: true,
    group: 'site',
    blurb:
      'One command, with every download checked. Homebrew and npm, what it runs on, and how to go back a version.',
  },
  {
    href: '/security',
    label: 'Security',
    inHeader: true,
    group: 'site',
    blurb:
      'What tula promises about your keys and your funds, what enforces each promise, and where the limits are.',
  },
  {
    href: '/privacy',
    label: 'Privacy',
    inHeader: false,
    group: 'site',
    blurb:
      'What this site measures about a visit, the analytics choice and how to change it, and what the binary sends: nothing.',
  },
  {
    href: '/keys',
    label: 'Keys',
    inHeader: false,
    group: 'guide',
    shelf: 'topic',
    blurb:
      'Every key the shell answers to, grouped by what it is for, and which ones need a terminal that sends them.',
  },
  {
    href: '/liquidation-risk',
    label: 'Liquidation risk',
    inHeader: false,
    group: 'guide',
    shelf: 'topic',
    blurb:
      'Every liquidatable position across venues, in one list ordered by the move that liquidates it.',
  },
  {
    href: '/exposure',
    label: 'Exposure',
    inHeader: false,
    group: 'guide',
    shelf: 'topic',
    blurb:
      'Spot, perps and collateral netted per asset across venues, and an Equity total that never adds a perp’s notional.',
  },
  {
    href: '/stress-test',
    label: 'Stress test',
    inHeader: false,
    group: 'guide',
    shelf: 'topic',
    blurb:
      'One price move across every venue at once: the new total, each health factor and account ratio, and what liquidates.',
  },
  {
    href: '/wallets',
    label: 'Wallets',
    inHeader: false,
    group: 'guide',
    shelf: 'venue',
    blurb:
      'One public address read on nine EVM chains — the gas token and the ERC-20s a token list names — with no key.',
  },
  {
    href: '/hyperliquid',
    label: 'Hyperliquid',
    inHeader: false,
    group: 'guide',
    shelf: 'venue',
    blurb:
      'Liquidation price or account ratio by Hyperliquid account mode, builder dexes, sub-accounts, vaults and staked HYPE.',
  },
  {
    href: '/aave',
    label: 'Aave',
    inHeader: false,
    group: 'guide',
    shelf: 'venue',
    blurb:
      'Aave health factor and the move to liquidation, across twelve v3 markets on nine chains, from one address.',
  },
  {
    href: '/kraken',
    label: 'Kraken',
    inHeader: false,
    group: 'guide',
    shelf: 'venue',
    blurb: 'A read-only Kraken API key, in Kraken’s own permission names, and what tula refuses.',
  },
  {
    href: '/binance',
    label: 'Binance',
    inHeader: false,
    group: 'guide',
    shelf: 'venue',
    blurb:
      'A read-only Binance API key, in Binance’s own restriction names, and what tula refuses.',
  },
  {
    href: '/coinbase',
    label: 'Coinbase',
    inHeader: false,
    group: 'guide',
    shelf: 'venue',
    blurb:
      'A read-only Coinbase CDP key, in Coinbase’s own permission names, and what tula refuses.',
  },
  {
    href: '/hyperliquid-liquidation-calculator',
    label: 'Hyperliquid calculator',
    inHeader: false,
    group: 'guide',
    shelf: 'venue',
    under: '/hyperliquid',
    footerLabel: 'Liquidation price',
    blurb:
      'A Hyperliquid liquidation price for any perp, isolated or cross, with its real max leverage and margin tiers.',
  },
  {
    href: '/aave-health-factor-calculator',
    label: 'Aave calculator',
    inHeader: false,
    group: 'guide',
    shelf: 'venue',
    under: '/aave',
    footerLabel: 'Health factor',
    blurb:
      'An Aave v3 health factor and each collateral’s liquidation price, with every market’s thresholds and eMode.',
  },
  {
    href: '/hyperliquid-funding-calculator',
    label: 'Funding calculator',
    inHeader: false,
    group: 'guide',
    shelf: 'venue',
    under: '/hyperliquid',
    footerLabel: 'Funding rate',
    blurb: 'What Hyperliquid funding costs or pays a position: per hour, per day, and in a year.',
  },
  {
    href: '/hyperliquid-portfolio-tracker',
    label: 'Hyperliquid tracker',
    inHeader: false,
    group: 'guide',
    shelf: 'venue',
    under: '/hyperliquid',
    footerLabel: 'Portfolio tracker',
    blurb:
      'A Hyperliquid account from its public address: perps, spot, sub-accounts, funding and liquidation price.',
  },
  {
    href: '/crypto-portfolio-tracker-cli',
    label: 'Terminal trackers',
    inHeader: false,
    group: 'guide',
    shelf: 'topic',
    blurb: 'Open-source crypto portfolio trackers for the terminal, and what each one reads.',
  },
] as const

/**
 * Named and referenced by hand rather than through Next's `opengraph-image`
 * convention, which exports the file with no extension at all. A static host
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

/** Where a guide's own share card is exported, beside the site's. */
export const guideCard = (href: string) => `/og${href}.png`

/**
 * The iOS home-screen icon. Declared rather than left to Next's
 * `apple-icon` file convention, which exports it with no extension — the same
 * reason `OG_IMAGE` is named by hand above.
 */
export const APPLE_ICON = { url: '/apple-icon.png', size: 180 } as const

/** The raster favicon, for the search results that do not take an SVG one. */
export const ICON = { url: '/icon.png', size: 96 } as const

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
  'hyperliquid liquidation calculator',
  'aave health factor calculator',
  'funding rate calculator',
  'hyperliquid funding rate',
  'hyperliquid portfolio tracker',
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
  'kraken api',
  'binance api',
  'hyperliquid positions',
  'aave health factor',
  'ethereum',
  'arbitrum',
  'base chain',
  'polygon',
  'optimism',
  'avalanche',
  'gnosis',
  'scroll',
  'linea',
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
  'agentic',
  'ai agent',
  'natural language query',
  'llm terminal',
]
