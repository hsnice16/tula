import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import type { Position, PositionKind } from './position.js'
import {
  healthFactorUnder,
  liquidationRisk,
  moveFromHealthFactor,
  scenario,
  shockPrices,
  whatBreaksFirst,
} from './risk.js'

const NOW = new Date('2026-08-30T12:00:00Z')
const d = (v: string | number) => new Decimal(v)

type PosSpec = Omit<Partial<Position>, 'asset' | 'quantity' | 'kind'> & {
  asset: string
  quantity: string
  kind?: PositionKind
}

function pos(overrides: PosSpec): Position {
  const q = d(overrides.quantity)
  return {
    id: overrides.id ?? `v:${overrides.kind ?? 'spot'}:${overrides.asset}`,
    venue: overrides.venue ?? 'v',
    kind: overrides.kind ?? 'spot',
    asset: overrides.asset,
    quantity: q,
    delta: q,
    asOf: NOW,
    ...(overrides.liquidation ? { liquidation: overrides.liquidation } : {}),
  }
}

describe('moveFromHealthFactor', () => {
  test('health factor 2 survives a 50% drawdown', () => {
    expect(moveFromHealthFactor(d(2)).toFixed(4)).toBe('-0.5000')
  })

  test('health factor 1.42 breaks at -29.6%', () => {
    expect(moveFromHealthFactor(d('1.42')).toFixed(4)).toBe('-0.2958')
  })

  test('at or below 1 the buffer is zero, not negative', () => {
    expect(moveFromHealthFactor(d(1)).toString()).toBe('0')
    expect(moveFromHealthFactor(d('0.9')).toString()).toBe('0')
  })
})

describe('liquidationRisk', () => {
  const prices = new Map([['ETH', d(4000)]])

  test('a long liquidates on the way down', () => {
    const risk = liquidationRisk(
      pos({ asset: 'ETH', quantity: '1', kind: 'perp', liquidation: { price: d(3000) } }),
      prices,
    )
    expect(risk.move?.toFixed(4)).toBe('-0.2500')
  })

  test('a short liquidates on the way up', () => {
    const risk = liquidationRisk(
      pos({ asset: 'ETH', quantity: '-1', kind: 'perp', liquidation: { price: d(5000) } }),
      prices,
    )
    expect(risk.move?.toFixed(4)).toBe('0.2500')
  })

  test('health factor wins over a price when both are present', () => {
    const risk = liquidationRisk(
      pos({
        asset: 'ETH',
        quantity: '1',
        kind: 'collateral',
        liquidation: { healthFactor: d(2), price: d(1) },
      }),
      prices,
    )
    expect(risk.move?.toFixed(4)).toBe('-0.5000')
  })

  test('no liquidation data yields null, which is not safety', () => {
    expect(liquidationRisk(pos({ asset: 'ETH', quantity: '1' }), prices).move).toBeNull()
  })

  test('a liquidation price with no market price yields null', () => {
    const risk = liquidationRisk(
      pos({ asset: 'XYZ', quantity: '1', kind: 'perp', liquidation: { price: d(10) } }),
      prices,
    )
    expect(risk.move).toBeNull()
  })
})

describe('whatBreaksFirst', () => {
  test('nearest first, regardless of direction', () => {
    const positions = [
      pos({ id: 'far', asset: 'ETH', quantity: '-1', kind: 'perp', liquidation: { price: d(6000) } }),
      pos({ id: 'near', asset: 'ETH', quantity: '1', kind: 'collateral', liquidation: { healthFactor: d('1.1') } }),
    ]
    const order = whatBreaksFirst(positions, new Map([['ETH', d(4000)]])).map((r) => r.position.id)
    expect(order).toEqual(['near', 'far'])
  })

  test('positions that cannot be liquidated are not listed', () => {
    expect(whatBreaksFirst([pos({ asset: 'ETH', quantity: '1' })], new Map())).toHaveLength(0)
  })

  test('unknown distance sorts last', () => {
    const positions = [
      pos({ id: 'unknown', asset: 'XYZ', quantity: '1', kind: 'perp', liquidation: { price: d(1) } }),
      pos({ id: 'known', asset: 'ETH', quantity: '1', kind: 'collateral', liquidation: { healthFactor: d(3) } }),
    ]
    const order = whatBreaksFirst(positions, new Map([['ETH', d(4000)]])).map((r) => r.position.id)
    expect(order).toEqual(['known', 'unknown'])
  })
})

describe('shockPrices', () => {
  test('applies a signed move and leaves other assets alone', () => {
    const out = shockPrices(
      new Map([
        ['ETH', d(4000)],
        ['BTC', d(60000)],
      ]),
      [{ asset: 'ETH', pct: d('-0.2') }],
    )
    expect(out.get('ETH')?.toString()).toBe('3200')
    expect(out.get('BTC')?.toString()).toBe('60000')
  })

  test('a shock on an unpriced asset is a no-op, not an invented price', () => {
    expect(shockPrices(new Map(), [{ asset: 'ETH', pct: d('-0.2') }]).size).toBe(0)
  })
})

describe('scenario', () => {
  const prices = new Map([
    ['ETH', d(4000)],
    ['USDC', d(1)],
  ])

  test('values the whole book before and after', () => {
    const result = scenario(
      [pos({ asset: 'ETH', quantity: '2' })],
      prices,
      [{ asset: 'ETH', pct: d('-0.25') }],
    )
    expect(result.before.total.toString()).toBe('8000')
    expect(result.after.total.toString()).toBe('6000')
    expect(result.change.toString()).toBe('-2000')
  })

  test('a fall liquidates the collateral but not the short', () => {
    const collateral = pos({
      id: 'lend',
      asset: 'ETH',
      quantity: '10',
      kind: 'collateral',
      liquidation: { healthFactor: d('1.42') },
    })
    const short = pos({
      id: 'perp',
      asset: 'ETH',
      quantity: '-4',
      kind: 'perp',
      liquidation: { price: d(5200) },
    })
    const result = scenario([collateral, short], prices, [{ asset: 'ETH', pct: d('-0.35') }])
    expect(result.liquidated.map((p) => p.id)).toEqual(['lend'])
  })

  test('a rise liquidates the short but not the collateral', () => {
    const short = pos({
      id: 'perp',
      asset: 'ETH',
      quantity: '-4',
      kind: 'perp',
      liquidation: { price: d(5000) },
    })
    const collateral = pos({
      id: 'lend',
      asset: 'ETH',
      quantity: '10',
      kind: 'collateral',
      liquidation: { healthFactor: d('1.42') },
    })
    const result = scenario([short, collateral], prices, [{ asset: 'ETH', pct: d('0.3') }])
    expect(result.liquidated.map((p) => p.id)).toEqual(['perp'])
  })

  test('a shock short of the threshold liquidates nothing', () => {
    const collateral = pos({
      asset: 'ETH',
      quantity: '10',
      kind: 'collateral',
      liquidation: { healthFactor: d('1.42') },
    })
    expect(scenario([collateral], prices, [{ asset: 'ETH', pct: d('-0.2') }]).liquidated).toHaveLength(0)
  })

  test('a shock on an unrelated asset does not liquidate', () => {
    const collateral = pos({
      asset: 'ETH',
      quantity: '10',
      kind: 'collateral',
      liquidation: { healthFactor: d('1.42') },
    })
    expect(scenario([collateral], prices, [{ asset: 'BTC', pct: d('-0.9') }]).liquidated).toHaveLength(0)
  })
})

describe('healthFactorUnder', () => {
  test('scales with the collateral move', () => {
    expect(healthFactorUnder(d(2), d('-0.25')).toString()).toBe('1.5')
  })
})
