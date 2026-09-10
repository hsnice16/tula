import { aaveConnector } from './aave.js'
import { binanceConnector } from './binance.js'
import { coinbaseConnector } from './coinbase.js'
import { hyperliquidConnector } from './hyperliquid.js'
import { krakenConnector } from './kraken.js'
import { stripeConnector } from './stripe.js'
import { walletConnector } from './wallet.js'
import type { Connector } from './types.js'

/**
 * Every venue in the build, and the only list of them.
 *
 * It was four: `src/index.ts` held the one that ships and three test files each
 * retyped it, so a venue dropped from the build stayed in the rosters those
 * tests assert against — every one of them still passing, about a build that no
 * longer existed. `src/index.ts` cannot be the export, because importing it runs
 * the CLI.
 *
 * Wallet, Hyperliquid and Aave come first because they need only a public
 * address: the cheapest thing a new user can safely connect. Named rather than
 * counted — a count says nothing about which rows moved when a fourth is added.
 * The menu sorts alphabetically; this order is what `tula help` and `/about` list.
 */
export const CONNECTORS = new Map<string, Connector>(
  [
    walletConnector,
    hyperliquidConnector,
    aaveConnector,
    krakenConnector,
    coinbaseConnector,
    binanceConnector,
    stripeConnector,
  ].map((c) => [c.venue.id, c]),
)
