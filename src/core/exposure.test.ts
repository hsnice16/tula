import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import { canonicalAsset, netExposure, oldest, portfolioValue } from './exposure.js'
import type { Position, PositionKind } from './position.js'

const T0 = new Date('2026-08-30T10:00:00Z')
const T1 = new Date('2026-08-30T11:00:00Z')

function pos(
  venue: string,
  asset: string,
  quantity: string,
  kind: PositionKind = 'spot',
  asOf: Date = T1,
): Position {
  const q = new Decimal(quantity)
  return { id: `${venue}:${kind}:${asset}`, venue, kind, asset, quantity: q, delta: q, asOf }
}

describe('netExposure', () => {
  test('nets one asset across venues and kinds', () => {
    // Long spot on Kraken, short perp on Hyperliquid, pledged on Aave.
    const exposures = netExposure([
      pos('kraken', 'ETH', '2.5'),
      pos('hyperliquid', 'ETH', '-4', 'perp'),
      pos('aave', 'ETH', '10', 'collateral'),
    ])
    expect(exposures).toHaveLength(1)
    expect(exposures[0]?.delta.toString()).toBe('8.5')
    expect(exposures[0]?.contributors).toHaveLength(3)
  })

  test('debt subtracts because quantities are signed', () => {
    const exposures = netExposure([
      pos('aave', 'USDC', '5000', 'collateral'),
      pos('aave', 'USDC', '-3000', 'debt'),
    ])
    expect(exposures[0]?.delta.toString()).toBe('2000')
  })

  test('inherits the oldest contributor, not the newest', () => {
    const exposures = netExposure([pos('a', 'ETH', '1', 'spot', T1), pos('b', 'ETH', '1', 'spot', T0)])
    expect(exposures[0]?.asOf).toEqual(T0)
  })

  test('notional is null without a price, never zero', () => {
    const [priced, unpriced] = netExposure(
      [pos('a', 'ETH', '2'), pos('a', 'XYZ', '100')],
      new Map([['ETH', new Decimal(4000)]]),
    )
    expect(priced?.asset).toBe('ETH')
    expect(priced?.notional?.toString()).toBe('8000')
    expect(unpriced?.notional).toBeNull()
  })

  test('ranks by notional, unpriced last', () => {
    const exposures = netExposure(
      [pos('a', 'SOL', '10'), pos('a', 'BTC', '1'), pos('a', 'XYZ', '999')],
      new Map([
        ['SOL', new Decimal(200)],
        ['BTC', new Decimal(60000)],
      ]),
    )
    expect(exposures.map((e) => e.asset)).toEqual(['BTC', 'SOL', 'XYZ'])
  })

  test('two venues spelling one ticker differently hold one asset', () => {
    // Hyperliquid's spot list says `PURR` and a wallet token list says `purr`.
    // Bucketed by the raw string they were two rows that never net, which is
    // the netting this function exists for, not doing it.
    const exposures = netExposure(
      [pos('hyperliquid', 'PURR', '100'), pos('wallet', 'purr', '-40')],
      new Map([['PURR', new Decimal(2)]]),
    )
    expect(exposures).toHaveLength(1)
    expect(exposures[0]?.asset).toBe('PURR')
    expect(exposures[0]?.delta.toString()).toBe('60')
    expect(exposures[0]?.notional?.toString()).toBe('120')
  })

  test('a price quoted under the other spelling still prices the row', () => {
    const exposures = netExposure([pos('wallet', 'purr', '100')], new Map([['PURR', new Decimal(2)]]))
    expect(exposures[0]?.notional?.toString()).toBe('200')
  })

  test('a stale price ages the row, however fresh the balance is', () => {
    // A CoinPaprika quote can be hours old. Read from the positions alone, it
    // rendered under a two-second AS OF — a stale figure presented as live.
    const exposures = netExposure(
      [pos('a', 'ETH', '2', 'spot', T1)],
      new Map([['ETH', new Decimal(4000)]]),
      new Map([['ETH', T0]]),
    )
    expect(exposures[0]?.asOf).toEqual(T0)
  })

  test('the age of a quote says nothing about a row that has none', () => {
    const exposures = netExposure([pos('a', 'XYZ', '2', 'spot', T1)], new Map(), new Map([['XYZ', T0]]))
    expect(exposures[0]?.notional).toBeNull()
    expect(exposures[0]?.asOf).toEqual(T1)
  })

  test('ranks a large short ahead of a small long', () => {
    const exposures = netExposure(
      [pos('a', 'ETH', '-5', 'perp'), pos('a', 'SOL', '1')],
      new Map([
        ['ETH', new Decimal(4000)],
        ['SOL', new Decimal(200)],
      ]),
    )
    expect(exposures[0]?.asset).toBe('ETH')
  })
})

describe('portfolioValue', () => {
  test('sums priced legs and names what it had to leave out', () => {
    const exposures = netExposure(
      [pos('a', 'ETH', '2'), pos('a', 'XYZ', '100')],
      new Map([['ETH', new Decimal(4000)]]),
    )
    const value = portfolioValue(exposures)
    expect(value.total?.toString()).toBe('8000')
    expect(value.unpriced).toEqual(['XYZ'])
  })

  test('a book nobody could price has no total, rather than a total of zero', () => {
    const exposures = netExposure([pos('a', 'XYZ', '100'), pos('a', 'ABC', '5')], new Map())
    const value = portfolioValue(exposures)
    expect(value.total).toBeNull()
    expect(value.unpriced).toEqual(['ABC', 'XYZ'])
  })

  // An account holding nothing is worth zero, and saying so is not a guess.
  test('an empty book still totals zero', () => {
    expect(portfolioValue([]).total?.toString()).toBe('0')
  })

  test('a short reduces the total', () => {
    const exposures = netExposure(
      [pos('a', 'ETH', '2'), pos('b', 'ETH', '-3', 'perp')],
      new Map([['ETH', new Decimal(4000)]]),
    )
    expect(portfolioValue(exposures).total?.toString()).toBe('-4000')
  })
})

describe('oldest', () => {
  test('returns null for an empty portfolio', () => {
    expect(oldest([])).toBeNull()
  })

  test('finds the stalest input', () => {
    expect(oldest([pos('a', 'ETH', '1', 'spot', T1), pos('b', 'BTC', '1', 'spot', T0)])).toEqual(T0)
  })

  test('a price older than every balance is what dates the view', () => {
    // The status line said the book was seconds old while it was being valued
    // at prices from an hour before.
    expect(oldest([pos('a', 'ETH', '1', 'spot', T1)], new Map([['ETH', T0]]))).toEqual(T0)
  })

  test('a timestamp that does not parse is skipped, not reported as the oldest', () => {
    const bad = new Map([['ETH', new Date('garbage')]])
    expect(oldest([pos('a', 'ETH', '1', 'spot', T1)], bad)).toEqual(T1)
  })
})

describe('canonicalAsset', () => {
  test('one spelling per asset, so two venues cannot hold it twice', () => {
    expect(canonicalAsset('purr')).toBe(canonicalAsset('PURR'))
  })
})
