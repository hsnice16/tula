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
})
