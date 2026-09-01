import { describe, expect, test } from 'bun:test'
import { wrapLines } from './wrap.js'

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
})
