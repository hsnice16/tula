import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import type { Position, PositionKind } from './position.js'
import {
  collateralMoveUnder,
  healthFactorUnder,
  liquidationRisk,
  moveFromHealthFactor,
  scenario,
  shockedHealthFactors,
  shockPrices,
  usableShock,
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

  test('spot is not listed, because nothing can call it', () => {
    expect(whatBreaksFirst([pos({ asset: 'ETH', quantity: '1' })], new Map())).toHaveLength(0)
  })

  test('a leveraged perp the venue said nothing about is a row, not an absence', () => {
    // The dangerous half of the case above, and the one that was missing:
    // Hyperliquid sends a null liquidation price and Binance sends 0 on a perp
    // it will not yet liquidate, so a real leveraged book was filtered down to
    // nothing and answered "no leverage, no borrowing, nothing to call".
    const ranked = whatBreaksFirst(
      [pos({ id: 'blind', asset: 'ETH', quantity: '10', kind: 'perp' })],
      new Map([['ETH', d(4000)]]),
    )
    expect(ranked.map((r) => r.position.id)).toEqual(['blind'])
    expect(ranked[0]?.move).toBeNull()
    expect(ranked[0]?.liquidatable).toBe(false)
  })

  test('a perp with no liquidation price sorts behind every perp that has one', () => {
    const positions = [
      pos({ id: 'blind', asset: 'ETH', quantity: '10', kind: 'perp' }),
      pos({ id: 'far', asset: 'ETH', quantity: '1', kind: 'perp', liquidation: { price: d(1000) } }),
    ]
    const order = whatBreaksFirst(positions, new Map([['ETH', d(4000)]])).map((r) => r.position.id)
    expect(order).toEqual(['far', 'blind'])
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

  test('a fall past zero leaves no price, rather than a negative one', () => {
    // `shock ETH -150` repriced the book to less than nothing and reported it.
    expect(shockPrices(new Map([['ETH', d(4000)]]), [{ asset: 'ETH', pct: d('-1.5') }]).has('ETH')).toBe(false)
  })

  test('a total loss leaves the asset unpriced, not priced at nothing', () => {
    expect(shockPrices(new Map([['ETH', d(4000)]]), [{ asset: 'ETH', pct: d('-1') }]).has('ETH')).toBe(false)
  })

  test('a percentage too large to be a scenario reprices nothing', () => {
    // `1e400` is Infinity to the parser and a finite Decimal here, and it
    // reprices a book to a four-hundred-digit figure.
    const runaway = new Decimal('1e400').div(100)
    expect(usableShock(runaway)).toBe(false)
    expect(shockPrices(new Map([['ETH', d(4000)]]), [{ asset: 'ETH', pct: runaway }]).has('ETH')).toBe(false)
  })

  test('the venue and the shock may spell one asset differently', () => {
    const out = shockPrices(new Map([['purr', d(2)]]), [{ asset: 'PURR', pct: d('-0.5') }])
    expect(out.get('purr')?.toString()).toBe('1')
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
    expect(result.before.total?.toString()).toBe('8000')
    expect(result.after.total?.toString()).toBe('6000')
    expect(result.change?.toString()).toBe('-2000')
  })

  test('an unpriced book reports no change, rather than a change of zero', () => {
    const result = scenario([pos({ asset: 'ETH', quantity: '2' })], new Map(), [
      { asset: 'ETH', pct: d('-0.25') },
    ])
    expect(result.before.total).toBeNull()
    expect(result.after.total).toBeNull()
    expect(result.change).toBeNull()
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

  test('a perp already past its trigger is gone in either direction', () => {
    // 10 ETH long against a liquidation price of 4,500 with the mark at 4,000
    // is already liquidatable, and `breaks` says so. The scenario read only the
    // sign of the move — which an already-liquidatable perp reports as a rise —
    // so a fall answered "nothing liquidates" and a rise answered that it went.
    // The reassuring one was the wrong one.
    const gone = pos({
      id: 'gone',
      asset: 'ETH',
      quantity: '10',
      kind: 'perp',
      liquidation: { price: d(4500) },
    })
    expect(whatBreaksFirst([gone], prices)[0]?.liquidatable).toBe(true)
    const under = (pct: string) =>
      scenario([gone], prices, [{ asset: 'ETH', pct: d(pct) }]).liquidated.map((p) => p.id)
    expect(under('-0.3')).toEqual(['gone'])
    expect(under('0.2')).toEqual(['gone'])
  })

  test('a fall past zero has no total, rather than a book worth nothing', () => {
    const result = scenario([pos({ asset: 'ETH', quantity: '2' })], prices, [
      { asset: 'ETH', pct: d('-1') },
    ])
    expect(result.before.total?.toString()).toBe('8000')
    expect(result.after.total).toBeNull()
    expect(result.after.unpriced).toEqual(['ETH'])
    expect(result.change).toBeNull()
  })

  test('one collateral asset falling moves a health factor by its share, not all of it', () => {
    // 10 WETH at $4,000 beside 1 WBTC at $60,000 is 40% of a $100k base, so a
    // 30% fall in WETH is a 12% fall in what secures the debt: 1.42 -> 1.25,
    // and nothing is called. Read as the whole base falling 30%, it reported
    // 0.99 and LIQUIDATED — a wrong number given to two decimal places.
    const market = new Map([
      ['WETH', d(4000)],
      ['WBTC', d(60000)],
    ])
    const legs = [
      pos({ id: 'weth', venue: 'aave', asset: 'WETH', quantity: '10', kind: 'collateral', liquidation: { healthFactor: d('1.42') } }),
      pos({ id: 'wbtc', venue: 'aave', asset: 'WBTC', quantity: '1', kind: 'collateral', liquidation: { healthFactor: d('1.42') } }),
    ]
    const shocks = [{ asset: 'WETH', pct: d('-0.3') }]

    expect(collateralMoveUnder(legs, market, shocks).get('aave')?.toFixed(4)).toBe('-0.1200')
    const rows = shockedHealthFactors(legs, market, shocks)
    expect(rows.map((r) => r.venue)).toEqual(['aave'])
    expect(rows[0]?.after?.toFixed(2)).toBe('1.25')
    expect(scenario(legs, market, shocks).liquidated).toHaveLength(0)
  })

  test('a market holding a leg nobody could price reports no new factor', () => {
    // The shares of the base are unknowable, and a share guessed at is the
    // wrong number this replaces.
    const legs = [
      pos({ venue: 'aave', asset: 'ETH', quantity: '10', kind: 'collateral', liquidation: { healthFactor: d('1.42') } }),
      pos({ venue: 'aave', asset: 'XYZ', quantity: '5', kind: 'collateral', liquidation: { healthFactor: d('1.42') } }),
    ]
    const shocks = [{ asset: 'ETH', pct: d('-0.9') }]
    expect(shockedHealthFactors(legs, prices, shocks)[0]?.after).toBeNull()
    expect(scenario(legs, prices, shocks).liquidated).toHaveLength(0)
  })

  test('a market whose collateral is one asset still moves with all of it', () => {
    const only = pos({
      venue: 'aave',
      asset: 'ETH',
      quantity: '10',
      kind: 'collateral',
      liquidation: { healthFactor: d('1.42') },
    })
    const rows = shockedHealthFactors([only], prices, [{ asset: 'ETH', pct: d('-0.25') }])
    expect(rows[0]?.after?.toFixed(2)).toBe('1.07')
  })

  const MIXED = new Map([
    ['WETH', d(4000)],
    ['WBTC', d(60000)],
  ])
  const mixedLegs = (wbtcThreshold?: Decimal): Position[] => [
    pos({
      id: 'weth',
      venue: 'aave',
      asset: 'WETH',
      quantity: '10',
      kind: 'collateral',
      liquidation: { healthFactor: d('1.42'), liquidationThreshold: d('0.83') },
    }),
    pos({
      id: 'wbtc',
      venue: 'aave',
      asset: 'WBTC',
      quantity: '1',
      kind: 'collateral',
      liquidation: {
        healthFactor: d('1.42'),
        ...(wbtcThreshold ? { liquidationThreshold: wbtcThreshold } : {}),
      },
    }),
  ]

  test('the threshold the venue pledged each leg at is read off the leg, not ignored', () => {
    // WETH is pledged at 0.83 and WBTC at 0.78, so WETH secures more of the
    // debt than its 40% of the value says: a 30% fall in it is 12.45% off the
    // base, not 12%, and the market ends at 1.24 rather than 1.25. Weighted by
    // value alone the thresholds the connector decodes changed no figure at all.
    const legs = mixedLegs(d('0.78'))
    const shocks = [{ asset: 'WETH', pct: d('-0.3') }]
    expect(collateralMoveUnder(legs, MIXED, shocks).get('aave')?.toFixed(4)).toBe('-0.1245')
    expect(shockedHealthFactors(legs, MIXED, shocks)[0]?.after?.toFixed(2)).toBe('1.24')
  })

  test('a leg with no threshold does not count as pledged in full beside siblings that have one', () => {
    // Read as 1 it would be the whole of its own value and outweigh every real
    // reserve, putting the base at -0.1069. The market falls back to value
    // alone instead, which is one unit across its legs.
    const legs = mixedLegs()
    expect(
      collateralMoveUnder(legs, MIXED, [{ asset: 'WETH', pct: d('-0.3') }])
        .get('aave')
        ?.toFixed(4),
    ).toBe('-0.1200')
  })
})

describe('healthFactorUnder', () => {
  test('scales with the collateral move', () => {
    expect(healthFactorUnder(d(2), d('-0.25')).toString()).toBe('1.5')
  })
})

/**
 * The factor moves the collateral and holds the debt at today's value, which is
 * a stablecoin borrow and not a same-asset one. It was true, stated in a comment
 * on `healthFactorUnder`, and never reachable by the person acting on the number.
 */
describe('what a shocked health factor assumed', () => {
  const market = new Map([
    ['ETH', d(4000)],
    ['USDC', d(1)],
  ])
  const legs = (debtAsset: string): Position[] => [
    pos({
      id: 'coll',
      venue: 'aave',
      asset: 'ETH',
      quantity: '10',
      kind: 'collateral',
      liquidation: { healthFactor: d('1.42') },
    }),
    pos({ id: 'debt', venue: 'aave', asset: debtAsset, quantity: '-4', kind: 'debt' }),
  ]

  test('a stablecoin borrow the shock never touches carries no caveat at all', () => {
    const rows = shockedHealthFactors(legs('USDC'), market, [{ asset: 'ETH', pct: d('-0.2') }])
    expect(rows[0]?.debt).toBeNull()
  })

  test('a borrow of the shocked asset is named, never left in the comment', () => {
    const rows = shockedHealthFactors(legs('ETH'), market, [{ asset: 'ETH', pct: d('-0.2') }])
    expect(rows[0]?.debt?.assets).toEqual(['ETH'])
  })

  test('a debt that falls with the collateral leaves the true factor above the one shown', () => {
    // The debt is worth less and is easier to cover, so holding it still
    // understates the market: the reader is told which side of it they are on.
    const rows = shockedHealthFactors(legs('ETH'), market, [{ asset: 'ETH', pct: d('-0.2') }])
    expect(rows[0]?.debt?.real).toBe('higher')
  })

  test('a debt that rises leaves the true factor below the one shown, which is the dangerous way round', () => {
    const rows = shockedHealthFactors(legs('ETH'), market, [{ asset: 'ETH', pct: d('0.2') }])
    expect(rows[0]?.debt?.real).toBe('lower')
  })

  test('two borrows moving opposite ways claim no direction rather than guessing one', () => {
    const both: Position[] = [
      ...legs('ETH'),
      pos({ id: 'debt2', venue: 'aave', asset: 'USDC', quantity: '-9000', kind: 'debt' }),
    ]
    const rows = shockedHealthFactors(both, market, [
      { asset: 'ETH', pct: d('-0.2') },
      { asset: 'USDC', pct: d('0.05') },
    ])
    expect(rows[0]?.debt?.assets).toEqual(['ETH', 'USDC'])
    expect(rows[0]?.debt?.real).toBe('unknown')
  })

  test('a debt at another venue is not read as this market’s', () => {
    const elsewhere: Position[] = [
      ...legs('USDC'),
      pos({ id: 'other', venue: 'compound', asset: 'ETH', quantity: '-2', kind: 'debt' }),
    ]
    expect(shockedHealthFactors(elsewhere, market, [{ asset: 'ETH', pct: d('-0.2') }])[0]?.debt).toBeNull()
  })
})
