import { describe, expect, test } from 'bun:test'
import {
  collateralLiquidationPrice,
  dropToLiquidation,
  FUNDING,
  fundingPaid,
  healthFactor,
  maintenanceMargin,
  perpLiquidationPrice,
} from './calc'
import { parse, pct, usd } from './format'

/** BTC's mainnet tiers: 40x, then 20x from $150M. */
const BTC = [
  { from: 0, maxLeverage: 40 },
  { from: 150_000_000, maxLeverage: 20 },
]

/** Hyperliquid's own: `price − side × margin_available / size / (1 − l × side)`. */
const documented = (side: 1 | -1, price: number, size: number, margin: number, l: number) =>
  price - (side * (margin - size * price * l)) / size / (1 - l * side)

describe('the Hyperliquid liquidation price', () => {
  const position = { size: 0.1, mark: 100_000, equity: 1_000, otherMaintenance: 0, tiers: BTC }

  test('is the documented formula, for a long and a short', () => {
    expect(perpLiquidationPrice({ ...position, side: 1 })).toBeCloseTo(
      documented(1, 100_000, 0.1, 1_000, 1 / 80),
      6,
    )
    expect(perpLiquidationPrice({ ...position, side: -1 })).toBeCloseTo(
      documented(-1, 100_000, 0.1, 1_000, 1 / 80),
      6,
    )
  })

  test('is where equity meets maintenance, in whichever tier that lands', () => {
    for (const equity of [10e6, 20e6, 30e6, 60e6]) {
      for (const side of [1, -1] as const) {
        const input = { side, size: 2_000, mark: 100_000, equity, otherMaintenance: 0, tiers: BTC }
        const price = perpLiquidationPrice(input)
        if (price === null) throw new Error('expected a price')
        const left = equity + side * 2_000 * (price - 100_000)
        expect(left).toBeCloseTo(maintenanceMargin(BTC, 2_000 * price), 3)
      }
    }
  })

  test('maintenance is continuous across a tier bound', () => {
    expect(maintenanceMargin(BTC, 150_000_000 - 1e-6)).toBeCloseTo(
      maintenanceMargin(BTC, 150_000_000),
      3,
    )
  })

  test('a long no fall can liquidate has no price; the backstop sits past the trigger', () => {
    expect(perpLiquidationPrice({ ...position, equity: 10_000, side: 1 })).toBeNull()
    const trigger = perpLiquidationPrice({ ...position, side: 1 }) ?? 0
    expect(perpLiquidationPrice({ ...position, side: 1 }, 2 / 3) ?? 0).toBeLessThan(trigger)
  })
})

describe('the Aave health factor', () => {
  // Aave's own example: $10,000 of collateral at 80% against $6,000.
  const eth = [{ value: 10_000, price: 2_500, threshold: 0.8 }]

  test('is thresholded collateral over debt, and nothing without debt', () => {
    expect(healthFactor(eth, 6_000)).toBeCloseTo(4 / 3, 9)
    expect(healthFactor(eth, 0)).toBeNull()
  })

  test('turns into the fall, and the price, that reach 1', () => {
    expect(dropToLiquidation(4 / 3)).toBeCloseTo(0.25, 9)
    expect(dropToLiquidation(0.9)).toBe(0)
    expect(collateralLiquidationPrice(eth, 0, 6_000)).toBeCloseTo(1_875, 6)
  })

  test('an asset the rest of the collateral covers for has no liquidation price', () => {
    const both = [...eth, { value: 10_000, price: 1, threshold: 0.78 }]
    expect(collateralLiquidationPrice(both, 0, 6_000)).toBeNull()
  })
})

describe('Hyperliquid funding', () => {
  test('a long pays a positive rate, a short receives it, and a negative rate turns both', () => {
    expect(fundingPaid(1, 10_000, 0.0001, 1)).toBeCloseTo(1, 9)
    expect(fundingPaid(-1, 10_000, 0.0001, 24)).toBeCloseTo(-24, 9)
    expect(fundingPaid(1, 10_000, -0.0001, 24)).toBeCloseTo(-24, 9)
  })

  test('the interest rate is the documented 0.01% every 8 hours, paid hourly', () => {
    expect(FUNDING.interestPerHour * 8).toBeCloseTo(0.0001, 12)
  })
})

describe('the figures typed in and printed', () => {
  test('parse takes plain decimals and nothing else', () => {
    expect(parse('1,250.5')).toBe(1250.5)
    expect(parse('1,250')).toBe(1250)
    expect(parse('1,5')).toBe(1.5)
    expect(parse('0,85')).toBe(0.85)
    expect(parse('1,25,0')).toBeNull()
    expect(parse('1.250,5')).toBeNull()
    expect(parse('$100')).toBe(100)
    for (const text of ['', '0x10', '1e3', 'Infinity', '-5', '1e400'])
      expect(parse(text)).toBeNull()
  })

  test('usd and pct carry their sign in front', () => {
    expect(usd(91_139.2405)).toBe('$91,139.24')
    expect(usd(-5)).toBe('−$5.00')
    expect(usd(0.000012345)).toBe('$0.0000123')
    expect(usd(1e-9)).toBe('<$0.00000001')
    expect(pct(0.0000001)).toBe('+<0.01%')
    expect(pct(0)).toBe('0.00%')
    expect(pct(-0.0886)).toBe('−8.86%')
    expect(pct(0.0864)).toBe('+8.64%')
  })
})
