import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import { mainnetTokens, scale, toPositions, type TokenEntry } from './wallet.js'

const token = (over: Partial<TokenEntry>): TokenEntry => ({
  chainId: 1,
  address: '0x6b175474e89094c44da98b954eedeac495271d0f',
  symbol: 'DAI',
  decimals: 18,
  ...over,
})

describe('token list filtering', () => {
  test('keeps only Ethereum mainnet entries', () => {
    const kept = mainnetTokens([token({}), token({ chainId: 42161, symbol: 'ARB' })])
    expect(kept.map((t) => t.symbol)).toEqual(['DAI'])
  })

  test('drops Aave receipt tokens so a wallet never double-counts collateral', () => {
    const kept = mainnetTokens([
      token({}),
      token({ symbol: 'aEthUSDC' }),
      token({ symbol: 'variableDebtEthWETH' }),
    ])
    expect(kept.map((t) => t.symbol)).toEqual(['DAI'])
  })

  test('a token whose address is malformed is not asked about', () => {
    expect(mainnetTokens([token({ address: 'not-an-address' })])).toHaveLength(0)
  })
})

describe('balance scaling', () => {
  test('respects the token’s own decimals rather than assuming 18', () => {
    expect(scale(1_500_000n, 6).toString()).toBe('1.5')
    expect(scale(10n ** 18n, 18).toString()).toBe('1')
  })

  test('keeps precision a float would lose', () => {
    // float64 rounds this to 123.45678901234568. decimal.js carries 20
    // significant digits — its default, which this repo does not raise — so
    // wei-exact amounts past that ceiling round rather than overflow.
    expect(scale(123456789012345678901n, 18).toString()).toBe('123.4567890123456789')
  })
})

describe('positions', () => {
  const asOf = new Date('2026-08-31T00:00:00Z')

  test('zero balances are dropped rather than rendered', () => {
    const out = toPositions(
      [
        { symbol: 'ETH', amount: new Decimal(2) },
        { symbol: 'DAI', amount: new Decimal(0) },
      ],
      asOf,
    )
    expect(out.map((p) => p.asset)).toEqual(['ETH'])
  })

  test('spot holdings are positive and carry their own delta and asOf', () => {
    const [position] = toPositions([{ symbol: 'weth', amount: new Decimal('1.5') }], asOf)
    expect(position?.kind).toBe('spot')
    expect(position?.asset).toBe('WETH')
    expect(position?.quantity.toString()).toBe('1.5')
    expect(position?.delta.toString()).toBe('1.5')
    expect(position?.asOf).toEqual(asOf)
  })
})
