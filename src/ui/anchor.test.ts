import { describe, expect, test } from 'bun:test'
import { terminalReply } from './anchor.js'

/**
 * The shapes a reply reaches a handler in. Ink takes an escape sequence's ESC
 * off, and where the ESC arrived alone and was flushed as the Esc key, the rest
 * arrives as text of its own — so both are replies, and nothing else is.
 */
describe('a terminal reply is recognised whole, and only whole', () => {
  test('the keyboard protocol answer, with its ESC and without', () => {
    expect(terminalReply('\x1b[?0u')).toEqual({ kind: 'keyboard', flags: 0 })
    expect(terminalReply('[?0u')).toEqual({ kind: 'keyboard', flags: 0 })
    expect(terminalReply('[?1u')).toEqual({ kind: 'keyboard', flags: 1 })
    expect(terminalReply('[?31u')).toEqual({ kind: 'keyboard', flags: 31 })
  })

  test('the cursor position answer, counted from row 0', () => {
    expect(terminalReply('\x1b[20;1R')).toEqual({ kind: 'cursor', row: 19 })
    expect(terminalReply('[1;80R')).toEqual({ kind: 'cursor', row: 0 })
  })

  test('typing, a part of a reply, and a kitty key are not replies', () => {
    for (const chunk of ['a', '[', '[?', '[?0', '?0u', 'x[?0u', '[?0uy', '[20;1', '[0;1R', '\x1b[13;2u', '[97;5u']) {
      expect({ chunk, reply: terminalReply(chunk) }).toEqual({ chunk, reply: null })
    }
  })
})
