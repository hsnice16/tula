import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import type { Position, PositionKind } from './position.js'
import { downloaded, holdings } from './format.js'

const at = (kind: PositionKind): Position => ({
  id: `x-${kind}`,
  venue: 'x',
  kind,
  asset: 'ETH',
  quantity: new Decimal(1),
  delta: new Decimal(1),
  asOf: new Date(),
})

describe('holdings', () => {
  test('a wallet holds tokens, not positions', () => {
    expect(holdings('wallet', [at('spot'), at('spot')])).toBe('2 tokens')
  })

  test('an exchange with only spot holds balances', () => {
    expect(holdings('cex', [at('spot')])).toBe('1 balance')
  })

  test('anything leveraged is a position wherever it sits', () => {
    expect(holdings('cex', [at('spot'), at('perp')])).toBe('2 positions')
    expect(holdings('lending', [at('debt')])).toBe('1 position')
  })

  test('pending money is still a balance, not a position', () => {
    expect(holdings('payments', [at('pending'), at('spot')])).toBe('2 balances')
  })

  test('an empty venue pluralises correctly', () => {
    expect(holdings('wallet', [])).toBe('0 tokens')
  })
})

describe('downloaded', () => {
  test('a percentage and both sizes, so the number can be checked against itself', () => {
    expect(downloaded(10_400_000, 20_800_000)).toBe('downloading 50% · 10.4 of 20.8 MB')
  })

  // Floor, not round: 99.6% must not read as done while bytes are still coming.
  test('never reads 100% before the last byte', () => {
    expect(downloaded(20_799_999, 20_800_000)).toContain('99%')
    expect(downloaded(20_800_000, 20_800_000)).toContain('100%')
  })

  test('bytes alone when the server sent no length', () => {
    expect(downloaded(1_500_000, null)).toBe('downloading 1.5 MB')
  })
})
