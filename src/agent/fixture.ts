import Decimal from 'decimal.js'
import { netExposure } from '../core/exposure.js'
import type { Position } from '../core/position.js'
import { scenario, whatBreaksFirst, type Shock } from '../core/risk.js'
import type { RiskEngine } from './engine.js'

export const FIXTURE_TIME = new Date('2026-08-30T12:00:00Z')

const d = (v: string) => new Decimal(v)

export const FIXTURE_POSITIONS: Position[] = [
  { id: 'a', venue: 'cex', kind: 'spot', asset: 'ETH', quantity: d('2.5'), delta: d('2.5'), asOf: FIXTURE_TIME },
  {
    id: 'b',
    venue: 'perp',
    kind: 'perp',
    asset: 'ETH',
    quantity: d('-4'),
    delta: d('-4'),
    asOf: FIXTURE_TIME,
    liquidation: { price: d('5200') },
  },
  {
    id: 'c',
    venue: 'lend',
    kind: 'collateral',
    asset: 'ETH',
    quantity: d('10'),
    delta: d('10'),
    asOf: FIXTURE_TIME,
    liquidation: { healthFactor: d('1.42') },
  },
  { id: 'e', venue: 'cex', kind: 'spot', asset: 'XYZ', quantity: d('7'), delta: d('7'), asOf: FIXTURE_TIME },
]

const PRICES = new Map([['ETH', d('4000')]])

/** A RiskEngine over fixed data, so agent tests never touch a venue or a price API. */
export const fixtureEngine: RiskEngine = {
  positions: () => FIXTURE_POSITIONS,
  exposures: () => netExposure(FIXTURE_POSITIONS, PRICES),
  breaks: () => whatBreaksFirst(FIXTURE_POSITIONS, PRICES),
  scenario: (shocks: Shock[]) => scenario(FIXTURE_POSITIONS, PRICES, shocks),
  priceOf: (asset: string) => PRICES.get(asset),
  venues: () => [
    { venue: 'cex', positions: 2, asOf: FIXTURE_TIME, status: 'ok' },
    { venue: 'perp', positions: 1, asOf: FIXTURE_TIME, status: 'ok' },
    { venue: 'lend', positions: 1, asOf: FIXTURE_TIME, status: 'ok' },
  ],
  freshness: () => ({
    oldest: FIXTURE_TIME,
    loadedAt: FIXTURE_TIME,
    failures: ['binance: credentials missing'],
    priceError: null,
  }),
}
