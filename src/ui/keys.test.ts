import { describe, expect, test } from 'bun:test'
import { typed } from './keys.js'

describe('typed input', () => {
  test('a space is a character, not whitespace to be trimmed', () => {
    // The regression that made `/shock ETH -20` impossible to type: every
    // command taking arguments needs a space to survive the keypress.
    expect(typed(' ')).toEqual({ text: ' ', submits: false })
  })

  test('an ordinary character passes through', () => {
    expect(typed('a')).toEqual({ text: 'a', submits: false })
  })

  test('a paste ending in a newline submits, without carrying the newline', () => {
    expect(typed('0xabc\n')).toEqual({ text: '0xabc', submits: true })
    expect(typed('0xabc\r\n')).toEqual({ text: '0xabc', submits: true })
  })

  test('interior newlines become spaces so the line stays editable', () => {
    expect(typed('shock ETH\n-20')).toEqual({ text: 'shock ETH -20', submits: false })
  })

  test('a trailing space inside a paste is kept', () => {
    expect(typed('shock ETH ')).toEqual({ text: 'shock ETH ', submits: false })
  })

  test('a bare newline submits an empty insertion', () => {
    expect(typed('\n')).toEqual({ text: '', submits: true })
  })
})
