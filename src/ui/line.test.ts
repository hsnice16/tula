import { describe, expect, test } from 'bun:test'
import {
  backwardBlankWord,
  moveRow,
  rowOf,
  visualRows,
  backwardWord,
  edit,
  forwardWord,
  insert,
  kill,
  lineEditor,
  replace,
  type LineCommand,
  type LineEditor,
} from './line.js'

/** A line with the cursor where `|` stands, which is how every case below reads. */
function at(marked: string, options: { secret?: boolean; killed?: string } = {}): LineEditor {
  const cursor = marked.indexOf('|')
  const text = marked.replace('|', '')
  return { ...lineEditor(text, options), cursor }
}

const shown = (ed: LineEditor): string => `${ed.text.slice(0, ed.cursor)}|${ed.text.slice(ed.cursor)}`

const run = (ed: LineEditor, ...commands: LineCommand[]): LineEditor =>
  commands.reduce(edit, ed)

describe('a word is what readline calls one', () => {
  // Every hand-rolled word motion disagrees with the one somebody's fingers
  // learned, and the disagreement is always about punctuation.
  test('an address is one word, and a slash command is two', () => {
    expect(forwardWord('0x12ab34cd', 0)).toBe(10)
    expect(shown(run(at('|/hyperliquid status'), 'forward-word'))).toBe('/hyperliquid| status')
    expect(shown(run(at('|/hyperliquid status'), 'forward-word', 'forward-word'))).toBe(
      '/hyperliquid status|',
    )
  })

  test('backward-word stops at the start of a word, not at the slash before it', () => {
    expect(backwardWord('/hyperliquid status', 19)).toBe(13)
    expect(backwardWord('/hyperliquid status', 13)).toBe(1)
    expect(backwardWord('/hyperliquid status', 1)).toBe(0)
  })

  test('a percentage is a word and its sign is not', () => {
    expect(shown(run(at('/shock ETH -20%|'), 'backward-word'))).toBe('/shock ETH -|20%')
  })

  test('letters outside ASCII are letters', () => {
    expect(forwardWord('比特币 ETH', 0)).toBe(3)
  })

  // ctrl+w is `unix-word-rubout`, whose boundary is whitespace; alt+backspace is
  // `backward-kill-word`, whose boundary is the word above. Two keys, two words.
  test('ctrl+w takes a blank-separated word, alt+backspace an alphanumeric one', () => {
    expect(backwardBlankWord('/hyperliquid status', 13)).toBe(0)
    expect(shown(run(at('/hyperliquid status|'), 'unix-word-rubout', 'unix-word-rubout'))).toBe('|')
    expect(shown(run(at('/hyperliquid status|'), 'backward-kill-word', 'backward-kill-word'))).toBe(
      '/|',
    )
  })
})

describe('motions', () => {
  test('start, end and one character either way', () => {
    expect(shown(run(at('ab|cd'), 'beginning-of-line'))).toBe('|abcd')
    expect(shown(run(at('ab|cd'), 'end-of-line'))).toBe('abcd|')
    expect(shown(run(at('ab|cd'), 'backward-char'))).toBe('a|bcd')
    expect(shown(run(at('ab|cd'), 'forward-char'))).toBe('abc|d')
    expect(shown(run(at('|ab'), 'backward-char'))).toBe('|ab')
    expect(shown(run(at('ab|'), 'forward-char'))).toBe('ab|')
  })

  test('an emoji is stepped over whole, never split into half a code point', () => {
    const ed = at('a🙂|b')
    expect(run(ed, 'backward-char').cursor).toBe(1)
    expect(run(ed, 'backward-delete-char').text).toBe('ab')
  })

  test('motions change nothing undo would restore', () => {
    const ed = run(insert(lineEditor(), 'abc'), 'beginning-of-line', 'end-of-line')
    expect(run(ed, 'undo').text).toBe('')
  })
})

describe('deleting', () => {
  test('backspace and delete take one character, and nothing at the edges', () => {
    expect(shown(run(at('ab|cd'), 'backward-delete-char'))).toBe('a|cd')
    expect(shown(run(at('ab|cd'), 'delete-char'))).toBe('ab|d')
    expect(shown(run(at('|ab'), 'backward-delete-char'))).toBe('|ab')
    expect(shown(run(at('ab|'), 'delete-char'))).toBe('ab|')
  })

  test('the one-character deletes do not touch the kill buffer', () => {
    expect(run(at('ab|cd', { killed: 'kept' }), 'backward-delete-char', 'delete-char').killed).toBe(
      'kept',
    )
  })

  test('ctrl+u and ctrl+k kill to either end, keeping what they took', () => {
    const back = run(at('/shock |ETH'), 'unix-line-discard')
    expect([shown(back), back.killed]).toEqual(['|ETH', '/shock '])
    const forward = run(at('/shock |ETH'), 'kill-line')
    expect([shown(forward), forward.killed]).toEqual(['/shock |', 'ETH'])
  })

  test('alt+d kills to the end of the word under or after the cursor', () => {
    const ed = run(at('/shock| ETH -20'), 'kill-word')
    expect([shown(ed), ed.killed]).toEqual(['/shock| -20', ' ETH'])
  })
})

describe('the kill buffer', () => {
  test('ctrl+y puts back what the last kill took', () => {
    expect(shown(run(at('/positions|'), 'unix-word-rubout', 'yank'))).toBe('/positions|')
  })

  // Readline's kill ring: consecutive kills are one entry, in line order.
  test('consecutive kills join, backward ones in front', () => {
    const ed = run(at('/shock ETH -20|'), 'unix-word-rubout', 'unix-word-rubout')
    expect(ed.killed).toBe('ETH -20')
    expect(shown(run(ed, 'yank'))).toBe('/shock ETH -20|')
  })

  test('consecutive forward kills join behind', () => {
    expect(run(at('|a b c'), 'kill-word', 'kill-word').killed).toBe('a b')
  })

  test('a motion between two kills starts a new entry', () => {
    expect(run(at('one two| three'), 'backward-kill-word', 'end-of-line', 'backward-kill-word').killed).toBe(
      'three',
    )
  })

  // The masked field. Its own line still loses the word — deleting has to work
  // where the dots give no other way to see what was typed — but nothing it
  // took is anywhere a yank on a visible line could reach.
  test('a secret line deletes as usual and keeps nothing it deleted', () => {
    const ed = run(at('sk-live-abcdef|', { secret: true }), 'unix-word-rubout')
    expect(ed.text).toBe('')
    expect(ed.killed).toBe('')
    expect(run(ed, 'kill-line').killed).toBe('')
    expect(kill(at('abc|', { secret: true, killed: 'visible' }), 0, 3, 'backward').killed).toBe('')
  })
})

describe('transpose-chars', () => {
  test('drags the character before the cursor over the one under it', () => {
    expect(shown(run(at('ab|cd'), 'transpose-chars'))).toBe('acb|d')
  })

  // The manual's own exception: with nothing under the cursor to drag, the two
  // characters before it are swapped — which is the fix for a typo just typed.
  test('at the end of the line, swaps the last two', () => {
    expect(shown(run(at('/exopsure|'), 'transpose-chars'))).toBe('/exopsuer|')
  })

  test('does nothing at the start of the line', () => {
    expect(shown(run(at('|ab'), 'transpose-chars'))).toBe('|ab')
  })
})

describe('undo', () => {
  test('typing undoes as one edit, and each kill as another', () => {
    let ed = insert(lineEditor(), '/')
    for (const ch of 'positions') ed = insert(ed, ch)
    ed = run(ed, 'backward-kill-word')
    expect(ed.text).toBe('/')
    expect(run(ed, 'undo').text).toBe('/positions')
    expect(run(ed, 'undo', 'undo').text).toBe('')
  })

  test('a replaced line comes back whole', () => {
    const ed = replace(at('/sho|'), '/shock ')
    expect(shown(ed)).toBe('/shock |')
    expect(shown(run(ed, 'undo'))).toBe('/sho|')
  })

  test('undo with nothing to undo leaves the line alone', () => {
    expect(shown(run(at('ab|'), 'undo'))).toBe('ab|')
  })
})

/**
 * The shell's text may run over several lines. Readline documents no buffer
 * that does, so these follow zsh's line editor, whose commands act on the line
 * the cursor is on: `tasks/field-report/11-multi-line-input.md` cites them.
 */
describe('a text of several lines', () => {
  test('start and end of line are the current line’s', () => {
    expect(shown(run(at('what\nbrea|ks\nfirst'), 'beginning-of-line'))).toBe('what\n|breaks\nfirst')
    expect(shown(run(at('what\nbrea|ks\nfirst'), 'end-of-line'))).toBe('what\nbreaks|\nfirst')
  })

  test('ctrl+u and ctrl+k kill to the ends of the current line', () => {
    expect(shown(run(at('one\ntw|o\nthree'), 'unix-line-discard'))).toBe('one\n|o\nthree')
    expect(shown(run(at('one\ntw|o\nthree'), 'kill-line'))).toBe('one\ntw|\nthree')
  })

  // zsh's `kill-line`: "if already on the end of the line, kill the newline".
  test('ctrl+k at the end of a line takes the newline, and repeating joins what it took', () => {
    const ed = run(at('one|\ntwo\nthree'), 'kill-line', 'kill-line', 'kill-line')
    expect([shown(ed), ed.killed]).toEqual(['one|three', '\ntwo\n'])
  })

  test('word motions and backspace cross a line break', () => {
    expect(shown(run(at('one\n|two'), 'backward-word'))).toBe('|one\ntwo')
    expect(shown(run(at('one|\ntwo'), 'forward-word'))).toBe('one\ntwo|')
    expect(shown(run(at('one\n|two'), 'backward-delete-char'))).toBe('one|two')
  })

  test('ctrl+t stays on its line', () => {
    expect(shown(run(at('ab\n|cd'), 'transpose-chars'))).toBe('ab\n|cd')
    expect(shown(run(at('ab\ncd|'), 'transpose-chars'))).toBe('ab\ndc|')
  })

  // Two UTF-16 units, one character: nothing on its line to swap it with.
  test('ctrl+t on a line holding one emoji changes nothing and leaves nothing to undo', () => {
    const ed = edit(lineEditor('ab\n😀'), 'transpose-chars')
    expect([shown(ed), ed.undo]).toEqual(['ab\n😀|', []])
  })
})

describe('rows as drawn', () => {
  // A cell short of the width, so the cursor at a row's end has a cell of its
  // own and never spills onto the row below.
  test('a line wraps a cell short of the width, and a newline always starts a row', () => {
    expect(visualRows('abcdefg', 4)).toEqual([
      { start: 0, end: 3, lastOfLine: false },
      { start: 3, end: 6, lastOfLine: false },
      { start: 6, end: 7, lastOfLine: true },
    ])
    expect(visualRows('ab\n\ncd', 10).map((r) => [r.start, r.end])).toEqual([
      [0, 2],
      [3, 3],
      [4, 6],
    ])
  })

  test('a wide character takes two cells of a row', () => {
    expect(visualRows('比特币', 5).map((r) => [r.start, r.end])).toEqual([
      [0, 2],
      [2, 3],
    ])
  })

  test('at a wrapped row’s end the cursor is drawn at the start of the next', () => {
    const rows = visualRows('abcdefg', 4)
    expect([rowOf(rows, 2), rowOf(rows, 3), rowOf(rows, 7)]).toEqual([0, 1, 2])
  })

  test('↑ and ↓ keep the column, and hand over to history on the first and last row', () => {
    const ed = at('what if\neth dro|ps 20%')
    expect(shown(moveRow(ed, 80, -1) ?? ed)).toBe('what if|\neth drops 20%')
    expect(moveRow(ed, 80, 1)).toBeNull()
    expect(moveRow(at('wha|t if\neth'), 80, -1)).toBeNull()
    expect(shown(moveRow(at('wha|t if\neth'), 80, 1) ?? ed)).toBe('what if\neth|')
  })

  test('↑ and ↓ walk the rows of one wrapped line too', () => {
    const ed = at('abcdef|g')
    expect(shown(moveRow(ed, 4, -1) ?? ed)).toBe('abc|defg')
    expect(shown(moveRow(at('a|bcdefg'), 4, 1) ?? ed)).toBe('abcd|efg')
  })
})
