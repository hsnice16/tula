/**
 * Other people's colours, which is why they are not in `theme.ts` — that file is
 * tula's own palette, and a venue's mark is not ours to restyle to match it.
 *
 * Every value is sampled from that brand's own artwork: the marks the site
 * already ships under `site/public/venues` for the three it shows, and the
 * vendor's own favicon for the rest. A hue picked by eye lands on a neighbouring
 * brand often enough that the mark stops identifying anything.
 */

/**
 * Ink measures a frame in the cells `string-width` counts, so an emoji here is a
 * column every branded row is wider than the erase that comes after it.
 */
export const BRAND_MARK = '●'

const BRAND: Readonly<Record<string, string>> = {
  aave: '#9c8cff',
  binance: '#f0b90b',
  circle: '#5fbfff',
  coinbase: '#0052ff',
  coingecko: '#4bcc00',
  coinmarketcap: '#3861fb',
  coinpaprika: '#ca312c',
  cryptocompare: '#00d665',
  hyperliquid: '#97fce4',
  kraken: '#7132f5',
  stripe: '#635bff',
  /** Not a vendor: the chain the balances are read off, in Ethereum's own colour. */
  wallet: '#627eea',
}

/**
 * The mark for a command line, keyed off its leading word — `kraken` and
 * `kraken positions` are the same venue. Undefined for everything else, which
 * is how `/breaks` and `/help` keep an empty gutter rather than a made-up one.
 */
export function brandColor(path: string): string | undefined {
  return BRAND[path.split(' ')[0]?.toLowerCase() ?? '']
}
