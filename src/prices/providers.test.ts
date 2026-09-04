import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PRICE_PROVIDERS } from './providers.js'

/**
 * A source names its key channel twice: on the connect screen, from `help`
 * here, and again in the message a rejected key produces — which is the one a
 * user reads at the moment they need it. They drifted once already, when
 * CryptoCompare's documentation moved to CoinDesk and only the connect screen
 * followed, so a rejected key was answered with the address of a page that no
 * longer issues one.
 *
 * The oracle cannot import this table — this table constructs the oracles — so
 * the modules are read as text.
 */
const MODULE: Readonly<Record<string, string>> = {
  coingecko: 'src/prices/coingecko.ts',
  coinmarketcap: 'src/prices/coinmarketcap.ts',
  cryptocompare: 'src/prices/cryptocompare.ts',
  coinpaprika: 'src/prices/coinpaprika.ts',
}

/**
 * Every URL an oracle puts in front of a user. A URL bound to a module-level
 * const is an endpoint it calls, not advice it gives.
 */
function advised(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => !/^const \w+ = 'https:/.test(line))
    .flatMap((line) => line.match(/https:\/\/[^\s'"`]+/g) ?? [])
}

describe('a price source points one way to its keys', () => {
  for (const provider of PRICE_PROVIDERS) {
    test(`${provider.id} advises only the links it lists`, () => {
      const path = MODULE[provider.id]
      expect({ id: provider.id, mapped: path !== undefined }).toEqual({
        id: provider.id,
        mapped: true,
      })
      const listed = provider.help.map((link) => link.url)
      for (const url of advised(readFileSync(path as string, 'utf8'))) {
        expect({ url, listed }).toEqual({ url, listed: expect.arrayContaining([url]) })
      }
    })
  }
})
