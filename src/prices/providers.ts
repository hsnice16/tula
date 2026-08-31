import { TulaError } from '../core/errors.js'
import type {
  Connectable,
  ConnectorCredentials,
  CredentialField,
  HelpLink,
} from '../connectors/types.js'
import type { PriceOracle } from '../core/prices.js'
import { CoinGeckoOracle } from './coingecko.js'
import { CoinMarketCapOracle } from './coinmarketcap.js'
import { CryptoCompareOracle } from './cryptocompare.js'
import { CoinPaprikaOracle } from './coinpaprika.js'

export interface PriceProvider {
  readonly id: string
  readonly name: string
  readonly summary: string
  /** Usable the moment it is chosen: there is nothing to paste. */
  readonly keyless: boolean
  readonly fields: readonly CredentialField[]
  readonly help: readonly HelpLink[]
  create(creds?: ConnectorCredentials): PriceOracle
}

/** Chosen because it needs no key: the product must price a book out of the box. */
export const DEFAULT_PROVIDER = 'coingecko'

const KEY_FIELD = (label: string, hint: string): CredentialField[] => [
  { name: 'apiKey', label, secret: true, hint },
]

export const PRICE_PROVIDERS: readonly PriceProvider[] = [
  {
    id: 'coingecko',
    name: 'CoinGecko',
    summary: 'Top 500 by market cap, no key required',
    keyless: true,
    fields: [],
    help: [{ label: 'CoinGecko API', url: 'https://www.coingecko.com/en/api' }],
    create: () => new CoinGeckoOracle(),
  },
  {
    id: 'coinmarketcap',
    name: 'CoinMarketCap',
    summary: 'Widest coverage; needs a free API key',
    keyless: false,
    fields: KEY_FIELD('API key', 'From pro.coinmarketcap.com — a data key, it cannot trade'),
    help: [
      { label: 'Create an API key', url: 'https://pro.coinmarketcap.com/account' },
      { label: 'API documentation', url: 'https://coinmarketcap.com/api/documentation/v1/' },
    ],
    create: (creds) => new CoinMarketCapOracle(requireKey(creds, 'CoinMarketCap')),
  },
  {
    id: 'cryptocompare',
    name: 'CryptoCompare',
    summary: 'Exchange-aggregated spot; needs a free API key',
    keyless: false,
    fields: KEY_FIELD('API key', 'From cryptocompare.com — a data key, it cannot trade'),
    help: [
      { label: 'Create an API key', url: 'https://www.cryptocompare.com/cryptopian/api-keys' },
      { label: 'API documentation', url: 'https://min-api.cryptocompare.com/documentation' },
    ],
    create: (creds) => new CryptoCompareOracle(requireKey(creds, 'CryptoCompare')),
  },
  {
    id: 'coinpaprika',
    name: 'CoinPaprika',
    summary: '2000 coins with a per-coin timestamp, no key required',
    keyless: true,
    fields: [],
    help: [
      { label: 'CoinPaprika API', url: 'https://api.coinpaprika.com/' },
      { label: 'API documentation', url: 'https://api.coinpaprika.com/docs' },
    ],
    create: () => new CoinPaprikaOracle(),
  },
]

function requireKey(creds: ConnectorCredentials | undefined, name: string): string {
  const key = creds?.['apiKey']
  if (!key) {
    throw new TulaError(
      `${name} needs an API key and none is stored.\n` +
        `  Add one with:  /${name.toLowerCase()} connect\n` +
        `  Or switch back to a source that needs none:  /coingecko use`,
    )
  }
  return key
}

export function priceProvider(id: string): PriceProvider | undefined {
  return PRICE_PROVIDERS.find((p) => p.id === id)
}

/**
 * One oracle per process. Falling back rather than failing keeps a stale or
 * removed selection from making the whole book unreadable — but the caller is
 * told, because silently pricing from something other than what was chosen is
 * the kind of quiet substitution this project refuses everywhere else.
 */
export function buildOracle(
  id: string | undefined,
  creds?: ConnectorCredentials,
): { oracle: PriceOracle; note?: string } {
  const chosen = priceProvider(id ?? DEFAULT_PROVIDER)
  if (!chosen) {
    return {
      oracle: new CoinGeckoOracle(),
      note: `"${id}" is not a price source this build knows. Using CoinGecko; pick one with /coingecko use.`,
    }
  }
  try {
    return { oracle: chosen.create(creds) }
  } catch (err) {
    // A stored selection whose key has gone missing must not stop the shell from
    // opening: quantities do not need a price source, and the note says what broke.
    return {
      oracle: new CoinGeckoOracle(),
      note: `${err instanceof Error ? err.message : String(err)}\nUsing CoinGecko meanwhile.`,
    }
  }
}

/** A live probe, so a bad key is refused at connect time rather than at first use. */
export async function verifyProvider(
  provider: PriceProvider,
  creds?: ConnectorCredentials,
): Promise<void> {
  const quote = await provider.create(creds).quote('BTC')
  if (!quote) {
    throw new TulaError(
      `${provider.name} answered, but returned no price for BTC.\n` +
        '  That is not a working price source; tula will not switch to it.',
    )
  }
}

/**
 * The connect screen, reused. A market-data key cannot trade or withdraw
 * anywhere — that is what the endpoint is — so nothing here is `unknown`, and
 * the probe still runs so a bad key is refused before it is stored.
 */
export function asConnectable(provider: PriceProvider): Connectable {
  return {
    id: provider.id,
    name: provider.name,
    fields: provider.fields,
    help: provider.help,
    async verifyScope(creds: ConnectorCredentials) {
      await verifyProvider(provider, creds)
      return { canRead: true, canTrade: false as const, canWithdraw: false as const }
    },
  }
}
