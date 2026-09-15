import { cells } from './wrap.js'

/**
 * The text being edited, as a value. Every surface that takes typing — the
 * shell's input, the palette's query, a connect field — holds one of these and
 * hands it a command, so a word motion means one thing on all of them and can
 * be tested without a terminal.
 *
 * The commands are GNU Readline's, by Readline's own names, because that is the
 * behaviour somebody's fingers learned in bash, python and every REPL built on
 * it. Where a hand-rolled version would be simpler and different — what a word
 * is, which kills accumulate, which way `transpose-chars` drags — the manual is
 * followed rather than improved on. `tasks/field-report/07-readline-keys.md`
 * cites the sections.
 *
 * The shell's text may hold newlines. Readline documents no buffer that does,
 * so the line commands follow zsh's, where each acts on the current line:
 * `tasks/field-report/11-multi-line-input.md` cites them.
 *
 * Positions are UTF-16 offsets that never land inside a surrogate pair: a
 * cursor between the halves of an emoji draws a replacement character and
 * deletes half a code point.
 */

export interface LineEditor {
  readonly text: string
  readonly cursor: number
  /** What `yank` puts back. */
  readonly killed: string
  /** Earlier states, newest last. */
  readonly undo: readonly Snapshot[]
  /**
   * What the previous edit was. A kill straight after a kill joins it, so
   * `ctrl+w ctrl+w ctrl+y` puts back both words; typing straight after typing
   * undoes as one step rather than one character at a time.
   */
  readonly last: 'insert' | 'kill-forward' | 'kill-backward' | null
  /**
   * A masked field. Its kills are never kept: a kill buffer that carried a
   * secret out of a field drawn as dots can put it back on a line drawn as text.
   */
  readonly secret: boolean
}

export interface Snapshot {
  readonly text: string
  readonly cursor: number
}

export type LineCommand =
  | 'beginning-of-line'
  | 'end-of-line'
  | 'backward-char'
  | 'forward-char'
  | 'backward-word'
  | 'forward-word'
  | 'backward-delete-char'
  | 'delete-char'
  | 'unix-word-rubout'
  | 'backward-kill-word'
  | 'kill-word'
  | 'unix-line-discard'
  | 'kill-line'
  | 'yank'
  | 'transpose-chars'
  | 'undo'

/** Enough to walk back through a long session of edits, and bounded, because a paste is one. */
const UNDO_DEPTH = 100

export function lineEditor(
  text = '',
  options: { secret?: boolean; killed?: string } = {},
): LineEditor {
  const secret = options.secret ?? false
  return {
    text,
    cursor: text.length,
    killed: secret ? '' : (options.killed ?? ''),
    undo: [],
    last: null,
    secret,
  }
}

/** Readline's word: letters and digits, so `0x12ab` is one and `/hyperliquid status` is two. */
export const isWordChar = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch)

const isSpace = (ch: string): boolean => /\s/u.test(ch)

/** The code point before `at`, stepping over a surrogate pair whole. */
export function before(text: string, at: number): number {
  if (at <= 0) return 0
  const low = text.charCodeAt(at - 1)
  const high = text.charCodeAt(at - 2)
  return low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? at - 2 : at - 1
}

/** The code point after `at`, stepping over a surrogate pair whole. */
export function after(text: string, at: number): number {
  if (at >= text.length) return text.length
  const high = text.charCodeAt(at)
  const low = text.charCodeAt(at + 1)
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? at + 2 : at + 1
}

/** The character starting at `at`, whole. */
export const charAt = (text: string, at: number): string => text.slice(at, after(text, at))

export const lineStart = (text: string, at: number): number => text.lastIndexOf('\n', at - 1) + 1

export function lineEnd(text: string, at: number): number {
  const newline = text.indexOf('\n', at)
  return newline === -1 ? text.length : newline
}

/** `forward-word`: past any non-word characters, then to the end of the word after them. */
export function forwardWord(text: string, at: number): number {
  let i = at
  while (i < text.length && !isWordChar(charAt(text, i))) i = after(text, i)
  while (i < text.length && isWordChar(charAt(text, i))) i = after(text, i)
  return i
}

/** `backward-word`: back over any non-word characters, then to the start of the word before them. */
export function backwardWord(text: string, at: number): number {
  let i = at
  while (i > 0 && !isWordChar(charAt(text, before(text, i)))) i = before(text, i)
  while (i > 0 && isWordChar(charAt(text, before(text, i)))) i = before(text, i)
  return i
}

/**
 * `unix-word-rubout`'s boundary, which is whitespace rather than Readline's
 * word — the one kill whose word is not the motions' word, and the one bash
 * binds to ctrl+w. On `/hyperliquid status` it takes `status`, then
 * `/hyperliquid`, where alt+backspace would stop at the slash.
 */
export function backwardBlankWord(text: string, at: number): number {
  let i = at
  while (i > 0 && isSpace(charAt(text, before(text, i)))) i = before(text, i)
  while (i > 0 && !isSpace(charAt(text, before(text, i)))) i = before(text, i)
  return i
}

const snapshot = (ed: LineEditor): Snapshot => ({ text: ed.text, cursor: ed.cursor })

const remembered = (ed: LineEditor): readonly Snapshot[] =>
  [...ed.undo, snapshot(ed)].slice(-UNDO_DEPTH)

const clamp = (text: string, at: number): number => Math.max(0, Math.min(text.length, at))

/** The cursor moved and nothing else did. A kill after it starts a new entry. */
export const moved = (ed: LineEditor, cursor: number): LineEditor => ({
  ...ed,
  cursor: clamp(ed.text, cursor),
  last: null,
})

/** Typing or a paste at the cursor. Consecutive typing undoes as one edit. */
export function insert(ed: LineEditor, text: string): LineEditor {
  if (text === '') return ed
  return {
    ...ed,
    text: ed.text.slice(0, ed.cursor) + text + ed.text.slice(ed.cursor),
    cursor: ed.cursor + text.length,
    undo: ed.last === 'insert' ? ed.undo : remembered(ed),
    last: 'insert',
  }
}

/**
 * Removes `[from, to)` into the kill buffer, joining the previous kill when
 * this one follows it — appended when killing forward, prepended when killing
 * back, so what is put back reads in the order it stood on the line.
 */
export function kill(
  ed: LineEditor,
  from: number,
  to: number,
  direction: 'forward' | 'backward',
): LineEditor {
  const start = clamp(ed.text, Math.min(from, to))
  const end = clamp(ed.text, Math.max(from, to))
  if (start === end) return { ...ed, last: null }
  const taken = ed.text.slice(start, end)
  const joining = ed.last === 'kill-forward' || ed.last === 'kill-backward'
  const killed = ed.secret
    ? ed.killed
    : !joining
      ? taken
      : direction === 'forward'
        ? ed.killed + taken
        : taken + ed.killed
  return {
    ...ed,
    text: ed.text.slice(0, start) + ed.text.slice(end),
    cursor: start,
    killed,
    undo: remembered(ed),
    last: direction === 'forward' ? 'kill-forward' : 'kill-backward',
  }
}

/** Deletes `[from, to)` without touching the kill buffer, as the one-character deletes do. */
export function remove(ed: LineEditor, from: number, to: number): LineEditor {
  const start = clamp(ed.text, Math.min(from, to))
  const end = clamp(ed.text, Math.max(from, to))
  if (start === end) return { ...ed, last: null }
  return {
    ...ed,
    text: ed.text.slice(0, start) + ed.text.slice(end),
    cursor: start,
    undo: remembered(ed),
    last: null,
  }
}

/**
 * The whole text swapped for another, as one undoable edit: a completion taken,
 * a suggestion accepted. Not for recalling history, which is a different line
 * rather than an edit to this one — `lineEditor` starts that fresh.
 */
export function replace(ed: LineEditor, text: string, cursor = text.length): LineEditor {
  if (text === ed.text && cursor === ed.cursor) return ed
  return { ...ed, text, cursor: clamp(text, cursor), undo: remembered(ed), last: null }
}

/** The text as it was before the last edit. Motions are not edits and are not undone. */
export function undo(ed: LineEditor): LineEditor {
  const previous = ed.undo.at(-1)
  if (!previous) return { ...ed, last: null }
  return { ...ed, text: previous.text, cursor: previous.cursor, undo: ed.undo.slice(0, -1), last: null }
}

export function edit(ed: LineEditor, command: LineCommand): LineEditor {
  const { text, cursor } = ed
  switch (command) {
    case 'beginning-of-line':
      return moved(ed, lineStart(text, cursor))
    case 'end-of-line':
      return moved(ed, lineEnd(text, cursor))
    case 'backward-char':
      return moved(ed, before(text, cursor))
    case 'forward-char':
      return moved(ed, after(text, cursor))
    case 'backward-word':
      return moved(ed, backwardWord(text, cursor))
    case 'forward-word':
      return moved(ed, forwardWord(text, cursor))
    case 'backward-delete-char':
      return remove(ed, before(text, cursor), cursor)
    case 'delete-char':
      return remove(ed, cursor, after(text, cursor))
    case 'unix-word-rubout':
      return kill(ed, backwardBlankWord(text, cursor), cursor, 'backward')
    case 'backward-kill-word':
      return kill(ed, backwardWord(text, cursor), cursor, 'backward')
    case 'kill-word':
      return kill(ed, cursor, forwardWord(text, cursor), 'forward')
    case 'unix-line-discard':
      return kill(ed, lineStart(text, cursor), cursor, 'backward')
    case 'kill-line': {
      // zsh's `kill-line`: at the end of a line it takes the newline, so
      // repeating it runs on through the lines below rather than stopping.
      const end = lineEnd(text, cursor)
      return kill(ed, cursor, end === cursor ? Math.min(text.length, end + 1) : end, 'forward')
    }
    case 'yank':
      return { ...insert({ ...ed, last: null }, ed.killed), last: null }
    case 'transpose-chars': {
      // At the end of a line there is no character under the cursor to drag,
      // so Readline swaps the last two instead of doing nothing. At the start
      // of one there is nothing before it on the line to drag.
      const start = lineStart(text, cursor)
      const end = lineEnd(text, cursor)
      if (cursor === start || end - start < 2) return { ...ed, last: null }
      const at = cursor >= end ? before(text, end) : cursor
      const left = before(text, at)
      if (left < start) return { ...ed, last: null }
      const past = after(text, at)
      const swapped = text.slice(0, left) + text.slice(at, past) + text.slice(left, at) + text.slice(past)
      return { ...ed, text: swapped, cursor: past, undo: remembered(ed), last: null }
    }
    case 'undo':
      return undo(ed)
  }
}

/** One row as drawn: `[start, end)` of the text, and whether a newline ends it rather than the width. */
export interface Row {
  start: number
  end: number
  lastOfLine: boolean
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })

/**
 * The rows the text is drawn in at `width` cells. Wrapped a character short of
 * the width, so the cursor always has a cell of its own at the end of a row
 * and never pushes it onto the next one. Hard-wrapped here rather than by Ink
 * so the rows ↑ and ↓ walk are the rows that are on the screen.
 */
export function visualRows(text: string, width: number): Row[] {
  const room = Math.max(1, Math.floor(width) - 1)
  const rows: Row[] = []
  let lineAt = 0
  for (const line of text.split('\n')) {
    let start = lineAt
    let used = 0
    let at = lineAt
    for (const { segment } of graphemes.segment(line)) {
      const size = cells(segment)
      if (used + size > room && at > start) {
        rows.push({ start, end: at, lastOfLine: false })
        start = at
        used = 0
      }
      used += size
      at += segment.length
    }
    rows.push({ start, end: at, lastOfLine: true })
    lineAt = at + 1
  }
  return rows
}

/** Which row the cursor is drawn on. At a wrapped row's end it is the start of the next. */
export function rowOf(rows: readonly Row[], cursor: number): number {
  for (let at = rows.length - 1; at >= 0; at--) {
    const row = rows[at]
    if (row && row.start <= cursor) return at
  }
  return 0
}

/**
 * The cursor one row up or down, at the same column where the row is long
 * enough — or null on the first row going up and the last going down, which is
 * where ↑ and ↓ go to history instead.
 */
export function moveRow(ed: LineEditor, width: number, direction: -1 | 1): LineEditor | null {
  const rows = visualRows(ed.text, width)
  const here = rowOf(rows, ed.cursor)
  const current = rows[here]
  const target = rows[here + direction]
  if (!current || !target) return null
  const column = cells(ed.text.slice(current.start, ed.cursor))
  let at = target.start
  let used = 0
  // A wrapped row's end is the next row's start, so the cursor stops a
  // character short of it; a row a newline ends can take the cursor at its end.
  const last = target.lastOfLine ? target.end : before(ed.text, target.end)
  while (at < last) {
    const next = after(ed.text, at)
    const size = cells(ed.text.slice(at, next))
    if (used + size > column) break
    used += size
    at = next
  }
  return moved(ed, at)
}
