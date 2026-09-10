import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import type { Position, PositionKind } from './position.js'
import {
  downloaded,
  freshness,
  healthFactor,
  holdings,
  pct,
  price,
  quantity,
  usd,
} from './format.js'

const d = (v: string | number) => new Decimal(v)

const at = (kind: PositionKind): Position => ({
  id: `x-${kind}`,
  venue: 'x',
  kind,
  asset: 'ETH',
  quantity: new Decimal(1),
  delta: new Decimal(1),
  asOf: new Date(),
})

describe('usd', () => {
  test('an unknown value is an em dash, never $0.00', () => {
    expect(usd(null)).toBe('—')
    expect(usd(d(0))).toBe('$0.00')
  })

  test('a real holding worth less than a cent does not read as worthless', () => {
    // `ETH 0.00000162  $0.00` is a priced, non-zero holding rendered as nothing
    // — the same confusion `usd(null)` returns an em dash to avoid, arrived at
    // from the other side. Every one of these came off a real book.
    expect(usd(d('0.003969'))).toBe('<$0.01')
    expect(usd(d('0.0000001'))).toBe('<$0.01')
    // A debt of less than a cent is still a debt, and still on the short side.
    expect(usd(d('-0.004'))).toBe('-<$0.01')
    // The boundary is what two places actually round, and a cent is a cent.
    expect(usd(d('0.005'))).toBe('$0.01')
    expect(usd(d('0.0049'))).toBe('<$0.01')
  })

  test('groups thousands, and only the thousands', () => {
    expect(usd(d('1234567.891'))).toBe('$1,234,567.89')
    expect(usd(d('999.994'))).toBe('$999.99')
  })

  test('the minus goes in front of the dollar sign, not inside the figure', () => {
    expect(usd(d('-4000'))).toBe('-$4,000.00')
  })

  test('a value no arithmetic could produce is an em dash, not $NaN', () => {
    // A single poisoned quote propagates through every sum it reaches, and
    // `$NaN` beside a real book is a wrong number with no way to read it.
    expect(usd(d(NaN))).toBe('—')
    expect(usd(d(Infinity))).toBe('—')
  })
})

describe('price', () => {
  test('a sub-cent price keeps its digits instead of rounding to $0.00', () => {
    // Every k-prefixed Hyperliquid perp — kPEPE, kSHIB, kBONK — prices here,
    // and a liquidation price of `$0.00` is a trigger reported as unreachable.
    expect(price(d('0.0000073'))).toBe('$0.0000073')
    expect(price(d('0.00000012345'))).toBe('$0.0000001235')
  })

  test('a near-par stablecoin shows the gap it is trading at', () => {
    expect(price(d('0.9987'))).toBe('$0.9987')
  })

  test('cents are never trimmed away', () => {
    expect(price(d('0.5'))).toBe('$0.50')
    expect(price(d(1))).toBe('$1.00')
  })

  test('a price at or above a dollar reads like money', () => {
    expect(price(d('68000'))).toBe('$68,000.00')
    expect(price(d('2450.5'))).toBe('$2,450.50')
  })

  test('there is no such thing as a price of zero', () => {
    expect(price(null)).toBe('—')
    expect(price(d(0))).toBe('—')
    expect(price(d(NaN))).toBe('—')
  })
})

describe('healthFactor', () => {
  test('two places, which is the resolution the difference is argued at', () => {
    expect(healthFactor(d('1.4239'))).toBe('1.42')
    expect(healthFactor(d(1))).toBe('1.00')
  })

  test('an account with no debt has no factor, rather than an enormous one', () => {
    expect(healthFactor(null)).toBe('—')
    expect(healthFactor(d(Infinity))).toBe('—')
  })
})

describe('pct', () => {
  test('every percentage carries its direction', () => {
    expect(pct(d('-0.2'))).toBe('-20.0%')
    expect(pct(d('0.25'))).toBe('+25.0%')
    expect(pct(d('-0.2'), 0)).toBe('-20%')
  })

  test('a clamped zero move is signed like every other figure', () => {
    // `moveFromHealthFactor` clamps to zero, and Decimal keeps the sign of the
    // subtraction that got there. Negative zero prints unsigned, so the one row
    // a reader must not miss rendered `0.0%` — the only output with no
    // direction on it at all.
    expect(pct(d('-0'))).toBe('+0.0%')
    expect(pct(d(0))).toBe('+0.0%')
  })

  test('a move too small to show still says which way it went', () => {
    expect(pct(d('-0.0004'))).toBe('-0.0%')
  })

  test('a non-finite fraction is an em dash, not `+Infinity%`', () => {
    expect(pct(d(Infinity))).toBe('—')
    expect(pct(d(NaN))).toBe('—')
  })
})

describe('quantity', () => {
  test('trailing zeros go so a column is scanned by its digits', () => {
    expect(quantity(d('2.5000'))).toBe('2.5')
    expect(quantity(d(8))).toBe('8')
  })

  test('a small balance keeps more places than a large one', () => {
    expect(quantity(d('1.234567891'))).toBe('1.2346')
    expect(quantity(d('0.000000012345'))).toBe('0.00000001')
  })

  test('a balance below the floor is not rendered as no balance at all', () => {
    // `WSTETH 0 — aave` off a real book: a holding that exists, drawn as one
    // that does not. The row stays — a dropped row is the same wrong answer
    // with nothing left on screen to question — and says which side of the
    // floor it is on.
    expect(quantity(d('0.000000001'))).toBe('<0.00000001')
    expect(quantity(d('-0.000000001'))).toBe('-<0.00000001')
  })

  test('nothing held is zero, not minus zero', () => {
    // The sign is an artifact of the rounding, and `-0` in a quantity column
    // reads as a direction somebody is short in.
    expect(quantity(d('-0'))).toBe('0')
    expect(quantity(d(0))).toBe('0')
  })

  test('a short keeps its sign', () => {
    expect(quantity(d('-4'))).toBe('-4')
  })
})

describe('freshness', () => {
  const at = new Date('2026-08-30T12:00:00Z')
  const after = (ms: number) => new Date(at.getTime() + ms)

  test('an absolute time and an age, because either alone hides something', () => {
    expect(freshness(at, after(3_000))).toBe(`${at.toTimeString().slice(0, 8)} (3s ago)`)
  })

  test('the unit changes so a long age reads as one', () => {
    expect(freshness(at, after(90_000))).toContain('(2m ago)')
    expect(freshness(at, after(6 * 3_600_000))).toContain('(6h ago)')
    expect(freshness(at, after(3 * 86_400_000))).toContain('(3d ago)')
  })

  test('a clock behind the timestamp does not report a figure from the future', () => {
    expect(freshness(at, after(-5_000))).toContain('(0s ago)')
  })

  test('a timestamp that does not parse is an em dash, not `Invalid  (NaNd ago)`', () => {
    // A venue or a price source can send one, and the raw form reads as a bug
    // in tula rather than as the one thing it means: we do not know how old
    // this figure is.
    expect(freshness(new Date('garbage'), at)).toBe('—')
    expect(freshness(at, new Date('garbage'))).toBe('—')
  })
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
