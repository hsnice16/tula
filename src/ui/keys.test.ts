import { describe, expect, test } from 'bun:test'
import { editingCommand, enterKey, pasted, typed } from './keys.js'

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

const none = {
  ctrl: false,
  meta: false,
  shift: false,
  return: false,
  leftArrow: false,
  rightArrow: false,
  upArrow: false,
  downArrow: false,
  home: false,
  end: false,
  backspace: false,
  delete: false,
}

/**
 * Each form a newline key reaches the handler in, as Ink 7.1.1's parser hands
 * it on — `tasks/field-report/11-multi-line-input.md` lists the bytes.
 */
describe('the keys that insert a newline', () => {
  test('Enter alone submits, and with Shift, Alt or ctrl inserts a newline', () => {
    expect(enterKey('\r', { ...none, return: true })).toBe('submit')
    expect(enterKey('\r', { ...none, return: true, shift: true })).toBe('newline')
    expect(enterKey('\r', { ...none, return: true, meta: true })).toBe('newline')
    expect(enterKey('\r', { ...none, return: true, ctrl: true })).toBe('newline')
  })

  test('ctrl+j inserts one, as a line feed and as its own key under the kitty protocol', () => {
    expect(enterKey('\n', none)).toBe('newline')
    expect(enterKey('j', { ...none, ctrl: true })).toBe('newline')
  })

  // What tmux with `extended-keys` and xterm with modifyOtherKeys send, and
  // what Ink would otherwise hand on to be typed as `[27;2;13~`.
  test('the xterm form is read, and any other key in that form is dropped rather than typed', () => {
    expect(enterKey('[27;2;13~', none)).toBe('newline')
    expect(enterKey('[27;5;13~', none)).toBe('newline')
    expect(enterKey('[27;1;13~', none)).toBe('submit')
    expect(enterKey('[27;5;9~', none)).toBe('ignore')
    expect(enterKey('a', none)).toBeNull()
  })

  test('a paste keeps its line breaks, with a Windows break made one', () => {
    expect(pasted('one\r\ntwo\rthree\n')).toBe('one\ntwo\nthree\n')
  })

  test('a paste or a chunk carries no control character to the terminal', () => {
    expect(pasted('a\x1b]52;c;cHduZWQ=\x07b\x1b[2J\x9bc\td\n')).toBe('a]52;c;cHduZWQ=b[2Jc    d\n')
    expect(typed('x\x07\x1b[31my\tz')).toEqual({ text: 'x[31my    z', submits: false })
  })

  test('ctrl+_ undoes as the raw byte and as the key the kitty protocol sends', () => {
    expect(editingCommand('\x1f', none)).toBe('undo')
    expect(editingCommand('_', { ...none, ctrl: true })).toBe('undo')
  })
})
