import { describe, expect, test } from 'bun:test'
import { lineEditor, type LineEditor } from './line.js'
import { replay, vimEscape, vimState, vimUntracked, type VimState, type VimStep } from './vim.js'

/**
 * Every motion and operator in `tasks/field-report/10-vim-mode.md`, over the
 * line model and not only through the screen. A line is written with `|`
 * before the character the cursor is on, which is where NORMAL's block sits.
 */
function normal(marked: string, over: Partial<VimState> = {}): { state: VimState; editor: LineEditor } {
  const cursor = marked.indexOf('|')
  const text = marked.replace('|', '')
  return { state: { ...vimState(), mode: 'normal', ...over }, editor: { ...lineEditor(text), cursor } }
}

const shown = (step: { editor: LineEditor }) =>
  `${step.editor.text.slice(0, step.editor.cursor)}|${step.editor.text.slice(step.editor.cursor)}`

const type = (marked: string, keys: string, over: Partial<VimState> = {}): VimStep => {
  const { state, editor } = normal(marked, over)
  return replay(state, editor, keys)
}

const after = (marked: string, keys: string) => shown(type(marked, keys))

describe('modes', () => {
  test('vim starts in INSERT, so turning it on changes nothing the next key does', () => {
    expect(vimState().mode).toBe('insert')
  })

  test('Esc leaves INSERT a character to the left, as vim does', () => {
    const step = vimEscape(vimState(), lineEditor('/exposure'))
    expect([step.state.mode, shown(step)]).toEqual(['normal', '/exposur|e'])
  })

  test.each([
    ['i', 'ab|cd', 'ab|cd'],
    ['a', 'ab|cd', 'abc|d'],
    ['I', '  ab|cd', '  |abcd'],
    ['A', 'ab|cd', 'abcd|'],
    ['o', 'ab|cd', 'abcd\n|'],
    ['O', 'ab|cd', '|\nabcd'],
  ])('%s enters INSERT at its place', (key, from, to) => {
    const step = type(from, key)
    expect([step.state.mode, shown(step)]).toEqual(['insert', to])
  })
})

describe('motions', () => {
  test.each([
    ['h', 'abc|d', 'ab|cd'],
    ['l', 'a|bcd', 'ab|cd'],
    ['l', 'abc|d', 'abc|d'],
    ['3l', '|abcdef', 'abc|def'],
    ['w', '|foo.bar baz', 'foo|.bar baz'],
    ['W', '|foo.bar baz', 'foo.bar |baz'],
    ['e', '|foo.bar baz', 'fo|o.bar baz'],
    ['E', '|foo.bar baz', 'foo.ba|r baz'],
    ['b', 'foo.bar |baz', 'foo.|bar baz'],
    ['B', 'foo.bar |baz', '|foo.bar baz'],
    ['2w', '|one two three', 'one two |three'],
    ['0', '  ab|c', '|  abc'],
    ['^', '  ab|c', '  |abc'],
    ['$', '|abc', 'ab|c'],
    ['gg', '  ab|c', '  |abc'],
    ['G', '  ab|c', '  |abc'],
    ['fE', '|/shock ETH -20', '/shock |ETH -20'],
    ['tE', '|/shock ETH -20', '/shock| ETH -20'],
    ['Fs', '/shock ETH -2|0', '/|shock ETH -20'],
    ['Ts', '/shock ETH -2|0', '/s|hock ETH -20'],
    ['f ;', '|a b c', 'a b| c'],
    ['f ;,', '|a b c', 'a| b c'],
  ])('%s', (keys, from, to) => {
    expect(after(from, keys)).toBe(to)
  })

  // NORMAL's j and k are history, the same as ↑ and ↓ — Claude Code and Codex.
  test('j and k walk history rather than moving on one line', () => {
    expect(type('ab|c', 'k').effect).toBe('previous-history')
    expect(type('ab|c', 'j').effect).toBe('next-history')
  })

  // A slash means a command, in either mode.
  test('/ asks for the command menu', () => {
    expect(type('ab|c', '/').effect).toBe('open-menu')
  })
})

describe('operators', () => {
  test.each([
    // Vim's `w` word is a run of one class, so the slash is a word of its own.
    ['dw', '|/shock ETH', '|shock ETH', '/'],
    ['cw', '|/shock ETH', '|shock ETH', '/'],
    ['cw', 's|hock ETH', 's| ETH', 'hock'],
    ['dw', 's|hock ETH', 's|ETH', 'hock '],
    ['yw', '/shock |ETH -20', '/shock |ETH -20', 'ETH '],
    ['de', 'a|bc def', 'a| def', 'bc'],
    ['db', 'abc d|ef', 'abc |ef', 'd'],
    ['d$', 'ab|cd', 'a|b', 'cd'],
    ['d0', 'ab|cd', '|cd', 'ab'],
    ['dfE', '/sh|ock ETH', '/sh|TH', 'ock E'],
    ['dtE', '/sh|ock ETH', '/sh|ETH', 'ock '],
    ['dd', 'ab|cd', '|', 'abcd'],
    ['cc', 'ab|cd', '|', 'abcd'],
    ['yy', 'ab|cd', 'ab|cd', 'abcd'],
    ['D', 'ab|cd', 'a|b', 'cd'],
    ['C', 'ab|cd', 'ab|', 'cd'],
    ['x', 'ab|cd', 'ab|d', 'c'],
    ['3x', '|abcd', '|d', 'abc'],
    ['d2w', '|one two three', '|three', 'one two '],
    ['2dw', '|one two three', '|three', 'one two '],
  ])('%s', (keys, from, to, register) => {
    const step = type(from, keys)
    expect([shown(step), step.state.register]).toEqual([to, register])
  })

  test('c leaves INSERT, and d and y stay in NORMAL', () => {
    expect(type('|ab cd', 'cw').state.mode).toBe('insert')
    expect(type('|ab cd', 'dw').state.mode).toBe('normal')
    expect(type('|ab cd', 'yw').state.mode).toBe('normal')
  })

  test.each([
    ['r', 'ab|cd', 'rx', 'ab|xd'],
    ['r with a count', '|abcd', '3rx', 'xx|xd'],
    ['~', '|abCd', '~~~', 'ABc|d'],
    ['J on one line', 'ab|cd', 'J', 'ab|cd'],
    // The pair every vim user swaps two characters with.
    ['p', 'a|bc', 'xp', 'ac|b'],
    ['P', 'a|bc', 'xP', 'a|bc'],
  ])('%s', (_, from, keys, to) => {
    expect(after(from, keys)).toBe(to)
  })

  test('p puts the register after the cursor, and a count puts it that many times', () => {
    expect(after('|ab cd', 'yw$2p')).toBe('ab cdab ab| ')
  })
})

describe('text objects', () => {
  test.each([
    ['diw', '/shock E|TH -20', '/shock | -20'],
    ['daw', '/shock E|TH -20', '/shock |-20'],
    ['diW', 'a b.|c d', 'a | d'],
    ['daW', 'a b.|c d', 'a |d'],
    ['di"', 'say "he|llo" now', 'say "|" now'],
    ['da"', 'say "he|llo" now', 'say |now'],
    ['da"', 'say "he|llo"', 'sa|y'],
    ["di'", "say 'he|llo' now", "say '|' now"],
    ["da'", "say 'he|llo' now", 'say |now'],
    ['di(', 'f(a, (b|), c)', 'f(a, (|), c)'],
    ['da(', 'f(a, (b|), c)', 'f(a, |, c)'],
    ['di[', 'x[1|2]', 'x[|]'],
    ['da[', 'x[1|2]', '|x'],
    ['di{', 'x{1|2}y', 'x{|}y'],
    ['da{', 'x{1|2}y', 'x|y'],
  ])('%s', (keys, from, to) => {
    expect(after(from, keys)).toBe(to)
  })

  test('ciw changes the word and leaves INSERT there', () => {
    const step = type('/shock E|TH -20', 'ciwBTC\x1b')
    expect([step.state.mode, shown(step)]).toEqual(['normal', '/shock BT|C -20'])
  })
})

describe('counts, repeat and undo', () => {
  test('. repeats the last change, typed text included', () => {
    expect(after('|one two three', 'cwONE\x1bww.')).toBe('ONE two ON|E')
    expect(after('|abcdef', 'x..')).toBe('|def')
  })

  test('a count on . repeats it that many times', () => {
    expect(after('|abcdef', 'x3.')).toBe('|ef')
  })

  test('u undoes a change, and a change with its INSERT text is one undo', () => {
    expect(after('|/shock ETH', 'dwu')).toBe('|/shock ETH')
    expect(after('|/shock ETH', 'cwpositions\x1bu')).toBe('|/shock ETH')
  })

  test('an INSERT that used a key . cannot type again leaves nothing to repeat', () => {
    const entered = type('|ab', 'Ax')
    const left = replay(vimUntracked(entered.state), entered.editor, '\x1b')
    expect(left.state.lastChange).toBe('')
    expect(shown(replay(left.state, left.editor, '.'))).toBe(shown(left))
  })

  test('a newline typed in INSERT is repeated by .', () => {
    expect(after('|ab', 'A\ncd\x1b.')).toBe('ab\ncd\nc|d')
  })

  test('motions change nothing . or u would act on', () => {
    const step = type('|abc', 'x$')
    expect(step.state.lastChange).toBe('x')
    expect(shown(replay(step.state, step.editor, 'u'))).toBe('|abc')
  })

  test('a key that begins no command is dropped, not typed', () => {
    expect(after('ab|c', 'q')).toBe('ab|c')
    expect(type('ab|c', 'd').state.pending).toBe('d')
    expect(type('ab|c', 'dq').state.pending).toBe('')
  })
})

/**
 * Vim's own behaviour over a text of several lines: `j`, `k`, `gg` and `G` are
 * linewise, `o` and `O` open a line, and `J` joins them.
 */
describe('several lines', () => {
  test.each([
    ['j', 'ab|c\ndef', 'abc\nde|f'],
    ['k', 'abc\nd|ef', 'a|bc\ndef'],
    ['j onto a shorter line', 'abc|d\nxy', 'abcd\nx|y'],
    ['gg', 'one\ntwo\n  thr|ee', '|one\ntwo\n  three'],
    ['G', '|one\ntwo\n  three', 'one\ntwo\n  |three'],
    ['0 and $ stay on the line', 'one\ntw|o\nthree', 'one\n|two\nthree'],
  ])('%s', (label, from, to) => {
    const keys = label.startsWith('0') ? '0' : label.split(' ')[0] ?? ''
    expect(after(from, keys)).toBe(to)
  })

  test('$ goes to the last character of the current line only', () => {
    expect(after('o|ne\ntwo', '$')).toBe('on|e\ntwo')
  })

  test('j on the last line and k on the first walk history instead', () => {
    expect(type('abc\nd|ef', 'j').effect).toBe('next-history')
    expect(type('a|bc\ndef', 'k').effect).toBe('previous-history')
    expect(type('abc\nd|ef', 'k').effect).toBeNull()
  })

  test('o and O open a line below and above, in INSERT', () => {
    const below = type('on|e\ntwo', 'o')
    expect([below.state.mode, shown(below)]).toEqual(['insert', 'one\n|\ntwo'])
    const above = type('one\ntw|o', 'O')
    expect([above.state.mode, shown(above)]).toEqual(['insert', 'one\n|\ntwo'])
  })

  test.each([
    ['dd', 'one\ntw|o\nthree', 'one\n|three', 'two'],
    ['dd on the last line', 'one\nthr|ee', '|one', 'three'],
    ['2dd', 'o|ne\ntwo\nthree', '|three', 'one\ntwo'],
    ['dj', 'o|ne\ntwo\nthree', '|three', 'one\ntwo'],
    ['dk', 'one\ntw|o\nthree', '|three', 'one\ntwo'],
    ['dG', 'one\ntw|o\nthree', '|one', 'two\nthree'],
    ['dgg', 'one\ntw|o\nthree', '|three', 'one\ntwo'],
    ['yy', 'one\ntw|o', 'one\ntw|o', 'two'],
  ])('%s is linewise', (label, from, to, register) => {
    const step = type(from, label.split(' ')[0] ?? '')
    expect([shown(step), step.state.register, step.state.linewise]).toEqual([to, register, true])
  })

  test('cc empties the line and leaves INSERT on it', () => {
    const step = type('one\ntw|o\nthree', 'cc')
    expect([step.state.mode, shown(step)]).toEqual(['insert', 'one\n|\nthree'])
  })

  test('p and P put a linewise register on a line of its own', () => {
    expect(after('o|ne\ntwo', 'yyjp')).toBe('one\ntwo\n|one')
    expect(after('o|ne\ntwo', 'yyjP')).toBe('one\n|one\ntwo')
  })

  test('J joins with one space and drops the next line’s leading blanks', () => {
    expect(after('o|ne\n   two\nthree', 'J')).toBe('one| two\nthree')
    expect(after('o|ne\ntwo\nthree', '3J')).toBe('one two| three')
    expect(after('one\nth|ree', 'J')).toBe('one\nth|ree')
  })

  test('x, D and a count of l stop at the end of the line', () => {
    expect(after('ab|c\ndef', 'x')).toBe('a|b\ndef')
    expect(after('a|bc\ndef', 'D')).toBe('|a\ndef')
    expect(after('|abc\ndef', '9l')).toBe('ab|c\ndef')
  })

  test('Esc from INSERT stays on the line it was typed on', () => {
    const step = replay({ ...vimState() }, { ...lineEditor('one\n'), cursor: 4 }, '\x1b')
    expect(shown(step)).toBe('one\n|')
  })
})

