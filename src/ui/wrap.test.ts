import { describe, expect, test } from 'bun:test'
import { cells, wrapLines } from './wrap.js'

describe('wrapLines', () => {
  test('leaves short lines alone', () => {
    expect(wrapLines('BTC  0.4213', 40)).toEqual(['BTC  0.4213'])
  })

  test('keeps blank lines, because they separate blocks', () => {
    expect(wrapLines('one\n\ntwo', 40)).toEqual(['one', '', 'two'])
  })

  test('breaks at a space rather than mid-word', () => {
    expect(wrapLines('alpha beta gamma', 12)).toEqual(['alpha beta', 'gamma'])
  })

  test('cuts at the margin when a run has no space in it', () => {
    expect(wrapLines('0xabcdefabcdef', 6)).toEqual(['0xabcd', 'efabcd', 'ef'])
  })

  test('never emits a trailing blank row for a line that divides evenly', () => {
    expect(wrapLines('abcdef', 3)).toEqual(['abc', 'def'])
  })

  test('a row count is what the terminal will actually use', () => {
    const table = ['BTC   0.4213   $27,750.10', 'ETH  12.0080    $9,412.00'].join('\n')
    expect(wrapLines(table, 15)).toHaveLength(4)
  })

  test('a wide symbol takes the rows it really occupies, not half of them', () => {
    // Nine CJK characters are eighteen cells, so at a width of eighteen they
    // fill the row and the quantity beside them is the next one. Counted in
    // code units the line measures twelve and is left unwrapped — and a row
    // that wraps in the terminal but not here is a row Ink never takes back.
    expect(wrapLines('比特币以太坊莱特币 12', 18)).toEqual(['比特币以太坊莱特币', '12'])
  })

  test('a surrogate pair is never cut in half', () => {
    // Half a pair is a lone surrogate, which a terminal draws as a replacement
    // character and every column after it counts from the wrong place.
    const rows = wrapLines('🚀🚀🚀', 3)
    expect(rows).toEqual(['🚀', '🚀', '🚀'])
    expect(rows.every((row) => !/\p{Cs}/u.test(row))).toBe(true)
  })
})

describe('cells', () => {
  test('a CJK character is two columns wide, not one', () => {
    expect(cells('比特币')).toBe(6)
  })

  test('an emoji is two columns wide, however many code units it costs', () => {
    expect(cells('🚀')).toBe(2)
    // One grapheme, five code points: the terminal draws one glyph.
    expect(cells('👩‍🚀')).toBe(2)
  })

  test('a combining accent is drawn on the letter before it, not beside it', () => {
    expect(cells('e\u0301')).toBe(1)
  })

  test('plain ASCII is its own length', () => {
    expect(cells('BTC  0.4213')).toBe(11)
  })
})
