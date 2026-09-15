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
  const ETH = new Map([['ETH', new Decimal(4000)]])
  const perp = (venue: string, quantity: string, equity?: string): Position => ({
    ...pos(venue, 'ETH', quantity, 'perp'),
    ...(equity === undefined ? {} : { equity: new Decimal(equity) }),
  })

  test('sums priced legs and names what it had to leave out', () => {
    const value = portfolioValue([pos('a', 'ETH', '2'), pos('a', 'XYZ', '100')], ETH)
    expect(value.total?.toString()).toBe('8000')
    expect(value.unpriced).toEqual(['XYZ'])
  })

  test('a book nobody could price has no total, rather than a total of zero', () => {
    const value = portfolioValue([pos('a', 'XYZ', '100'), pos('a', 'ABC', '5')], new Map())
    expect(value.total).toBeNull()
    expect(value.unpriced).toEqual(['ABC', 'XYZ'])
  })

  // An account holding nothing is worth zero, and saying so is not a guess.
  test('an empty book still totals zero', () => {
    expect(portfolioValue([]).total?.toString()).toBe('0')
  })

  test('a debt reduces the total', () => {
    expect(portfolioValue([pos('a', 'ETH', '2'), pos('b', 'ETH', '-3', 'debt')], ETH).total?.toString()).toBe(
      '-4000',
    )
  })

  test('a short adds the equity its venue states, not its notional', () => {
    // -3 ETH at 4000 is -12,000 of notional. The venue says the position is up
    // 500, and that is all it adds to what the book is worth.
    const value = portfolioValue([pos('a', 'USDC', '1000'), perp('b', '-3', '500')], new Map([...ETH, ['USDC', new Decimal(1)]]))
    expect(value.total?.toString()).toBe('1500')
    expect(netExposure([perp('b', '-3', '500')], ETH)[0]?.notional?.toString()).toBe('-12000')
  })

  test('the same short moves the total by the same amount wherever its PnL is stated', () => {
    // Coinbase states the PnL on the position; Hyperliquid states it inside the
    // balance row beside it. Both are the same account, and one total.
    const prices = new Map([...ETH, ['USDC', new Decimal(1)]])
    const onThePosition = [pos('coinbase', 'USDC', '1000'), perp('coinbase', '-3', '500')]
    const inTheBalance = [pos('hyperliquid', 'USDC', '1500', 'collateral'), perp('hyperliquid', '-3', '0')]
    expect(portfolioValue(onThePosition, prices).total?.toString()).toBe(
      portfolioValue(inTheBalance, prices).total?.toString(),
    )
  })

  test('a derivative whose venue states no equity is named, never counted at its notional', () => {
    const value = portfolioValue([pos('a', 'ETH', '2'), perp('binance', '-3')], ETH)
    expect(value.total?.toString()).toBe('8000')
    expect(value.unstated).toEqual(['binance'])
  })

  test('a perp moves the total by its size times the price change', () => {
    const value = portfolioValue([perp('b', '-3', '500')], new Map([['ETH', new Decimal(3000)]]), ETH)
    expect(value.total?.toString()).toBe('3500')
  })

  test('a perp whose PnL lives in an unpriced balance does not make the book worth $0.00', () => {
    // Hyperliquid with the price source down: the USDC balance has no price, and
    // the perp beside it states zero because its PnL is inside that balance.
    const value = portfolioValue([pos('hl', 'USDC', '1500', 'collateral'), perp('hl', '-3', '0')], new Map())
    expect(value.total).toBeNull()
    expect(value.unpriced).toEqual(['USDC'])
  })

  test('a perp on an asset nobody prices still carries the equity its venue states', () => {
    const value = portfolioValue([{ ...perp('b', '-3', '250'), asset: 'xyz:TSLA' }], new Map())
    expect(value.total?.toString()).toBe('250')
    expect(value.unpriced).toEqual([])
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
