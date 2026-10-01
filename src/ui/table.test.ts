import { describe, expect, test } from 'bun:test'
import { renderTable } from './table.js'
import { cells } from './wrap.js'

/**
 * A table is a table only while every row is the same width on screen. Padding
 * counted in code units makes that untrue for any cell a terminal draws wider
 * than it measures, and the columns to the right of it land wherever the error
 * left them.
 */
const widths = (table: string) => new Set(table.split('\n').map(cells))

describe('renderTable', () => {
  test('a column is as wide as the widest cell in it', () => {
    const table = renderTable(['ASSET', 'NET'], [['BTC', '0.42'], ['ETHEREUM', '12']])
    expect(table.split('\n')[0]).toBe('ASSET     NET')
    expect(table.split('\n')[2]).toBe('BTC       0.42')
  })

  test('a venue that spells an asset in Chinese does not shove every column right', () => {
    const table = renderTable(
      ['ASSET', 'NET'],
      [
        ['BTC', '0.42'],
        ['比特币', '12'],
      ],
      ['left', 'right'],
    )
    expect(widths(table)).toEqual(new Set([12]))
  })

  test('an emoji ticker is measured in cells too, not in code units', () => {
    // One glyph, five code points: a woman, a zero-width joiner and a rocket.
    const table = renderTable(
      ['ASSET', 'NET'],
      [
        ['ABCD', '1'],
        ['👩‍🚀', '2'],
      ],
      ['left', 'right'],
    )
    expect(widths(table).size).toBe(1)
  })

  describe('fitted to a screen', () => {
    const HEAD = ['ACCOUNT', 'PRODUCT', 'QUANTITY', 'REASON', 'AS OF']
    const ROWS = [
      ['second (0x2222…2222)', 'vault 0x3333…3333', '708.7053', 'posted to an isolated perp', '09:28:32'],
      ['0x1111…1111', 'Total Staked', '0.000002', 'securing a borrow', '09:28:32'],
      ['0x1111…1111', 'Total Supplied', '5061', 'securing a debt', '09:28:31'],
    ]
    const ALIGN = ['left', 'left', 'right', 'left', 'left'] as const
    const ELASTIC = [false, true, false, true, false]

    test('cuts only the words it may, and keeps every figure and time whole', () => {
      const table = renderTable(HEAD, ROWS, [...ALIGN], { width: 80, elastic: ELASTIC })
      for (const line of table.split('\n')) expect(cells(line)).toBeLessThanOrEqual(80)
      for (const row of ROWS) {
        for (const keep of [row[0]!, row[2]!, row[4]!]) expect(table).toContain(keep)
      }
      expect(table).toContain('…')
    })

    test('never cuts two values to the same words, nor a word past reading', () => {
      // Narrower than anything can fit: the floor holds, and the row wraps instead.
      const lines = renderTable(HEAD, ROWS, [...ALIGN], { width: 20, elastic: ELASTIC }).split('\n').slice(2)
      const products = lines.map((l) => l.split(/ {2,}/)[1])
      expect(new Set(products).size).toBe(3)
      for (const shown of products) expect(cells(shown ?? '')).toBeGreaterThanOrEqual(12)
    })

    test('a table that fits is drawn exactly as it would be with no screen at all', () => {
      expect(renderTable(HEAD, ROWS, [...ALIGN], { width: 500, elastic: ELASTIC })).toBe(
        renderTable(HEAD, ROWS, [...ALIGN]),
      )
    })
  })
})
