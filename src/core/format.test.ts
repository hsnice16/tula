import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import type { Position, PositionKind } from './position.js'
import { holdings } from './format.js'

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
