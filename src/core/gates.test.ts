import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import { usablePrice } from './prices.js'
import { liquidationRisk, scenario, whatBreaksFirst } from './risk.js'
import type { Position } from './position.js'

/**
 * The two gates a wrong number would have to pass to reach the screen. Both
 * were open: a zero price rendered a real holding as `$0.00` with no note, and
 * an account already being liquidated rendered `+0.0%`, which reads as safe.
 */

describe('usablePrice', () => {
  test.each([0, -1, -0.5, NaN, Infinity, -Infinity, null, undefined, 'abc', {}, true])(
    'refuses %p',
    (raw) => {
      expect(usablePrice(raw)).toBeNull()
    },
  )

  test.each([
    [1, '1'],
    [0.00000001, '1e-8'],
    [1e-12, '1e-12'],
    [2500.5, '2500.5'],
    [1e21, '1e+21'],
  ])('accepts %p', (raw, want) => {
    expect(usablePrice(raw)?.toString()).toBe(want)
  })

  test('an array is refused', () => {
    // Not in the table above: `test.each` spreads an array row as arguments.
    expect(usablePrice([])).toBeNull()
    expect(usablePrice([1])).toBeNull()
  })

  test('a numeric string is refused rather than coerced', () => {
    // Coercing would route the value through `Number` and drop digits Decimal
    // exists to keep. No source sends strings; one that starts to should fail
    // loudly rather than round quietly.
    expect(usablePrice('2500.5')).toBeNull()
  })

  test('a zero would otherwise pass a truthiness check', () => {
    // Why the guard exists at all: `new Decimal(0)` is an object.
    expect(Boolean(new Decimal(0))).toBe(true)
    expect(usablePrice(0)).toBeNull()
  })

  test('a NaN would otherwise poison every sum it reached', () => {
    expect(new Decimal(NaN).plus(5).isNaN()).toBe(true)
    expect(usablePrice(NaN)).toBeNull()
  })
})

describe('a position already past its trigger', () => {
  const at = (healthFactor: string): Position => ({
    id: 'aave:collateral:ETH',
    venue: 'aave',
    kind: 'collateral',
    asset: 'ETH',
    quantity: new Decimal(1),
    delta: new Decimal(1),
    liquidation: { healthFactor: new Decimal(healthFactor) },
    asOf: new Date(),
  })

  test('is flagged, because a zero move cannot say so on its own', () => {
    expect(liquidationRisk(at('0.5'), new Map()).liquidatable).toBe(true)
    expect(liquidationRisk(at('1'), new Map()).liquidatable).toBe(true)
  })

  test('a healthy position is not flagged', () => {
    expect(liquidationRisk(at('2'), new Map()).liquidatable).toBe(false)
    expect(liquidationRisk(at('1.0001'), new Map()).liquidatable).toBe(false)
  })

  test('sorts ahead of every position that still has room', () => {
    const under = liquidationRisk(at('0.5'), new Map()).move
    const safe = liquidationRisk(at('1.42'), new Map()).move
    expect(under?.abs().lessThan(safe?.abs() ?? new Decimal(0))).toBe(true)
  })

  test('a perp past its trigger is flagged, in both directions', () => {
    // The branch that health factors do not reach. A long liquidates when the
    // mark falls to the trigger, a short when it rises to it.
    const perp = (qty: string, liq: string): Position => ({
      id: 'hyperliquid:perp:ETH',
      venue: 'hyperliquid',
      kind: 'perp',
      asset: 'ETH',
      quantity: new Decimal(qty),
      delta: new Decimal(qty),
      liquidation: { price: new Decimal(liq) },
      asOf: new Date(),
    })
    const at = (mark: string) => new Map([['ETH', new Decimal(mark)]])

    expect(liquidationRisk(perp('1', '1800'), at('2000')).liquidatable).toBe(false)
    expect(liquidationRisk(perp('1', '1800'), at('1800')).liquidatable).toBe(true)
    expect(liquidationRisk(perp('1', '1800'), at('1700')).liquidatable).toBe(true)

    expect(liquidationRisk(perp('-1', '2200'), at('2000')).liquidatable).toBe(false)
    expect(liquidationRisk(perp('-1', '2200'), at('2200')).liquidatable).toBe(true)
    expect(liquidationRisk(perp('-1', '2200'), at('2300')).liquidatable).toBe(true)
  })

  test('sorts ahead of a nearer-looking row, whatever the move says', () => {
    // A perp far past its trigger has a large move; the table's contract is
    // "nearest to liquidation first", and it is already there.
    const perp = (asset: string, qty: string, liq: string): Position => ({
      id: `hyperliquid:perp:${asset}`,
      venue: 'hyperliquid',
      kind: 'perp',
      asset,
      quantity: new Decimal(qty),
      delta: new Decimal(qty),
      liquidation: { price: new Decimal(liq) },
      asOf: new Date(),
    })
    const prices = new Map([
      ['ETH', new Decimal(1500)],
      ['SOL', new Decimal(100)],
    ])
    const ranked = whatBreaksFirst(
      [perp('SOL', '5', '90'), perp('ETH', '10', '3000')],
      prices,
    )
    expect(ranked[0]?.position.asset).toBe('ETH')
    expect(ranked[0]?.liquidatable).toBe(true)
  })

  test('a perp the venue gave no liquidation price for is unknown, never safe', () => {
    // The dangerous case, and the one this used to assert with a spot balance:
    // a perp is exactly the position that could have had liquidation data and
    // did not. Unknown is not false, and it is not an absence either — the row
    // is still ranked, at the bottom, where it cannot read as nothing to call.
    const { liquidation: _omitted, ...rest } = at('2')
    const blind = { ...rest, id: 'hyperliquid:perp:ETH', venue: 'hyperliquid', kind: 'perp' as const }
    const risk = liquidationRisk(blind, new Map())
    expect(risk.move).toBeNull()
    expect(risk.liquidatable).toBe(false)
    expect(whatBreaksFirst([blind], new Map()).map((r) => r.position.id)).toEqual([blind.id])
  })

  test('a shock does not read as safe on a perp that is already gone', () => {
    // The other half of the flag above: `breaks` said "liquidatable now" while
    // `shock ETH -30` on the same book said nothing liquidates, because the
    // scenario branched on the sign of the move and never read the flag.
    const gone: Position = {
      id: 'hyperliquid:perp:ETH',
      venue: 'hyperliquid',
      kind: 'perp',
      asset: 'ETH',
      quantity: new Decimal(10),
      delta: new Decimal(10),
      liquidation: { price: new Decimal(4500) },
      asOf: new Date(),
    }
    const prices = new Map([['ETH', new Decimal(4000)]])
    expect(liquidationRisk(gone, prices).liquidatable).toBe(true)
    for (const pct of ['-0.3', '0.2']) {
      const result = scenario([gone], prices, [{ asset: 'ETH', pct: new Decimal(pct) }])
      expect(result.liquidated.map((p) => p.id)).toEqual([gone.id])
    }
  })
})
