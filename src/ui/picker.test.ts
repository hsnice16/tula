import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import type { Position } from '../core/position.js'
import { paletteGeometry } from './Palette.js'
import { accountName } from '../core/format.js'
import { pickerTable } from './PositionPicker.js'
import { cells } from './wrap.js'

const ADDRESS = '0x2222222222222222222222222222222222222222'

const row = (asset: string, label: string, extra: Partial<Position> = {}): Position => ({
  id: `${label}:${asset}`,
  venue: 'hyperliquid',
  kind: 'perp',
  asset,
  quantity: new Decimal('20946.07'),
  delta: new Decimal('20946.07'),
  asOf: new Date(),
  account: { id: label, label },
  figures: { unrealisedPnl: new Decimal('-1234.5') },
  ...extra,
})

describe('the picker’s table', () => {
  test('an account reads as its name beside its address cut to the ends, or that address alone', () => {
    expect(accountName(`second (${ADDRESS})`)).toBe('second (0x2222…2222)')
    expect(accountName(ADDRESS)).toBe('0x2222…2222')
    expect(accountName('cold')).toBe('cold')
  })

  test('two accounts with long labels still fit the dialog, figures first and nothing cut', () => {
    // The book in the screenshot that prompted this: every row cut before its asset.
    const book = [
      row('HYPE', `second (${ADDRESS})`),
      row('AAVE', `second (${ADDRESS})`, { product: 'Total Staked' }),
      row('XRP', '0x1111111111111111111111111111111111111111'),
    ]
    const width = paletteGeometry(120, 40).listWidth
    const { head, rows } = pickerTable(book, width)
    for (const line of [...head, ...rows]) expect(cells(line) + 1).toBeLessThanOrEqual(width)
    // One venue on every row, so no VENUE column to spend the width on.
    expect(head[0]).toMatch(/^KIND\s+ASSET\s+QUANTITY\s+PNL\s+ACCOUNT\s+PRODUCT$/)
    for (const [at, asset] of ['HYPE', 'AAVE', 'XRP'].entries()) {
      expect(rows[at]).toContain(asset)
      expect(rows[at]).toContain('20946.07')
      expect(rows[at]).toContain('-$1,234.50')
    }
    expect(rows[0]).toContain('second (0x2222…2222)')
  })

  test('narrower, whole columns go before a figure is cut: PnL, product, venue, then account', () => {
    const book = [
      row('HYPE', `second (${ADDRESS})`, { product: 'Total Staked' }),
      row('XRP', '0x1111111111111111111111111111111111111111', { venue: 'hyperliquid-xyz' }),
    ]
    for (const columns of [100, 80, 70, 60]) {
      const width = paletteGeometry(columns, 30).listWidth
      const { head, rows } = pickerTable(book, width)
      for (const line of [...head, ...rows]) expect({ columns, fits: cells(line) + 1 <= width }).toEqual({ columns, fits: true })
      // Never a partial figure: the quantity is whole on every row, at every width.
      for (const line of rows) expect({ columns, whole: line.includes('20946.07') }).toEqual({ columns, whole: true })
      expect(head[0]).toContain('QUANTITY')
    }
    const at = (columns: number) => pickerTable(book, paletteGeometry(columns, 30).listWidth).head[0]!
    // The account outlasts the PnL: two accounts' rows must still read apart.
    expect(at(80)).not.toContain('PNL')
    expect(at(80)).toContain('ACCOUNT')
  })

})
