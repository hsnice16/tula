import { edit, insert, remove, replace, undo, type LineEditor } from './line.js'

/**
 * Vim editing for the input, over the same text model the readline keys use —
 * so an edit made in NORMAL undoes with the typing that came before it. The
 * command set is Claude Code's, which `tasks/field-report/10-vim-mode.md` lists;
 * this module is NORMAL mode, and INSERT is the readline line.
 *
 * The text may hold several lines, and the commands keep vim's own meaning over
 * them: `j` and `k` move a line, `o` opens one, `dd` and `dj` take whole lines.
 * `tasks/field-report/11-multi-line-input.md` cites the sections.
 *
 * Positions inside are counted in code points and converted at the edges, so
 * `x` on an emoji takes the emoji rather than half of it.
 */

export type VimMode = 'insert' | 'normal'

interface Find {
  kind: 'f' | 'F' | 't' | 'T'
  char: string
}

export interface VimState {
  readonly mode: VimMode
  /** Keys toward a command not yet complete: a count, an operator, `g`, `f`. */
  readonly pending: string
  /** What `d`, `c` and `y` last took, and `p` and `P` put back. */
  readonly register: string
  /** The register holds whole lines, so `p` puts it on a line of its own. */
  readonly linewise: boolean
  readonly lastFind: Find | null
  /** The keys of the last change, INSERT text and Esc included, for `.`. */
  readonly lastChange: string
  /** The keys of a change still being typed in INSERT. */
  readonly recording: string | null
}

/** Something the text cannot do on its own: walk history, or open the command menu. */
export type VimEffect = 'previous-history' | 'next-history' | 'open-menu' | null

export interface VimStep {
  state: VimState
  editor: LineEditor
  effect: VimEffect
}

/** INSERT, because turning vim on must not change what the next keystroke does. */
export const vimState = (): VimState => ({
  mode: 'insert',
  pending: '',
  register: '',
  linewise: false,
  lastFind: null,
  lastChange: '',
  recording: null,
})

type Op = 'd' | 'c' | 'y'

type Action =
  | { kind: 'motion'; key: string; char?: string }
  | { kind: 'object'; around: boolean; key: string }
  | { kind: 'line' }
  | { kind: 'simple'; key: string; char?: string }

interface Command {
  count: number
  op?: Op
  action: Action
}

const MOTIONS = 'hjklwebWEB0^$G;,'
const OBJECTS = 'wW"\'()[]{}bB'
const SIMPLE = 'xDC~JpPu.iIaAoO/'
/** The simple commands that change the text, and so are what `.` repeats. */
const CHANGES = 'xDC~JpPiIaAoO'
const ENTERS_INSERT = 'CiIaAoO'

/** Null for keys that cannot begin or continue a command; `done: false` to wait for more. */
function parse(keys: string): (Command & { done: true }) | { done: false } | null {
  const chars = [...keys]
  let at = 0
  const number = () => {
    let digits = ''
    while (at < chars.length && /[0-9]/.test(chars[at] ?? '') && !(digits === '' && chars[at] === '0')) {
      digits += chars[at++]
    }
    return digits
  }
  const first = number()
  if (at >= chars.length) return { done: false }
  let op: Op | undefined
  if ('dcy'.includes(chars[at] ?? '_')) op = chars[at++] as Op
  const second = op ? number() : ''
  if (at >= chars.length) return { done: false }
  const count = Number(first || 1) * Number(second || 1)
  const key = chars[at++] ?? ''
  const rest = chars.slice(at)
  const base = op ? { count, op } : { count }

  if (op && key === op) return rest.length === 0 ? { done: true, ...base, action: { kind: 'line' } } : null
  if (op && (key === 'i' || key === 'a')) {
    if (rest.length === 0) return { done: false }
    const object = rest[0] ?? ''
    return rest.length === 1 && OBJECTS.includes(object)
      ? { done: true, ...base, action: { kind: 'object', around: key === 'a', key: object } }
      : null
  }
  if (key === 'g') {
    if (rest.length === 0) return { done: false }
    return rest.length === 1 && rest[0] === 'g'
      ? { done: true, ...base, action: { kind: 'motion', key: 'gg' } }
      : null
  }
  if ('fFtT'.includes(key)) {
    if (rest.length === 0) return { done: false }
    return rest.length === 1
      ? { done: true, ...base, action: { kind: 'motion', key, char: rest[0] ?? '' } }
      : null
  }
  if (rest.length === 0 && MOTIONS.includes(key)) return { done: true, ...base, action: { kind: 'motion', key } }
  if (op) return null
  if (key === 'r') {
    if (rest.length === 0) return { done: false }
    return rest.length === 1 ? { done: true, count, action: { kind: 'simple', key, char: rest[0] ?? '' } } : null
  }
  if (rest.length === 0 && SIMPLE.includes(key)) return { done: true, count, action: { kind: 'simple', key } }
  return null
}

/** Vim's word classes: blank, keyword (`iskeyword` is letters, digits and `_`), and other. */
const kind = (ch: string | undefined, big: boolean): number =>
  ch === undefined || /\s/u.test(ch) ? 0 : big || /[\p{L}\p{N}_]/u.test(ch) ? 1 : 2

const offset = (cs: readonly string[], index: number): number => cs.slice(0, index).join('').length
const indexOf = (text: string, at: number): number => [...text.slice(0, at)].length

/** The first code point of the line holding `i`. */
function startOf(cs: readonly string[], i: number): number {
  let at = Math.min(i, cs.length)
  while (at > 0 && cs[at - 1] !== '\n') at--
  return at
}

/** The newline ending the line holding `i`, or the end of the text. */
function endOf(cs: readonly string[], i: number): number {
  let at = i
  while (at < cs.length && cs[at] !== '\n') at++
  return at
}

const lineOf = (cs: readonly string[], i: number): number =>
  cs.slice(0, i).filter((ch) => ch === '\n').length

const lineCount = (cs: readonly string[]): number => cs.filter((ch) => ch === '\n').length + 1

function lineAt(cs: readonly string[], n: number): number {
  let at = 0
  for (let line = 0; line < n && at <= cs.length; line++) at = endOf(cs, at) + 1
  return Math.min(at, cs.length)
}

function firstBlankless(cs: readonly string[], i: number): number {
  const end = endOf(cs, i)
  let at = startOf(cs, i)
  while (at < end && /[ \t]/.test(cs[at] ?? '')) at++
  return at
}

function wordStart(cs: readonly string[], i: number, big: boolean): number {
  const n = cs.length
  if (i >= n) return n
  const k = kind(cs[i], big)
  if (k !== 0) while (i < n && kind(cs[i], big) === k) i++
  while (i < n && kind(cs[i], big) === 0) i++
  return i
}

function wordEnd(cs: readonly string[], i: number, big: boolean): number {
  const n = cs.length
  i++
  while (i < n && kind(cs[i], big) === 0) i++
  if (i >= n) return Math.max(0, n - 1)
  const k = kind(cs[i], big)
  while (i + 1 < n && kind(cs[i + 1], big) === k) i++
  return i
}

function wordBack(cs: readonly string[], i: number, big: boolean): number {
  if (i <= 0) return 0
  i--
  while (i > 0 && kind(cs[i], big) === 0) i--
  const k = kind(cs[i], big)
  while (i > 0 && kind(cs[i - 1], big) === k) i--
  return i
}

/** `f` and its kin search the current line only, as vim's do. */
function found(cs: readonly string[], i: number, find: Find, count: number): number | null {
  const start = startOf(cs, i)
  const end = endOf(cs, i)
  let pos = i
  for (let step = 0; step < count; step++) {
    const forward = find.kind === 'f' || find.kind === 't'
    let j = forward ? pos + 1 : pos - 1
    while (j >= start && j < end && cs[j] !== find.char) j += forward ? 1 : -1
    if (j < start || j >= end) return null
    pos = j
  }
  return pos
}

interface Target {
  to: number
  inclusive: boolean
  /** Whole lines from the cursor's to the target's. */
  linewise?: boolean
  find?: Find
}

function target(
  cs: readonly string[],
  i: number,
  key: string,
  char: string | undefined,
  count: number,
  state: VimState,
  op: Op | undefined,
): Target | null {
  const n = cs.length
  const start = startOf(cs, i)
  const end = endOf(cs, i)
  const repeat = (step: (at: number) => number) => {
    let at = i
    for (let c = 0; c < count; c++) at = step(at)
    return at
  }
  switch (key) {
    case 'h':
      return { to: Math.max(start, i - count), inclusive: false }
    case 'l':
      return { to: Math.min(end, i + count), inclusive: false }
    case 'j':
    case 'k': {
      const line = lineOf(cs, i) + (key === 'j' ? count : -count)
      if (line < 0 || line >= lineCount(cs)) return null
      const lineStart = lineAt(cs, line)
      const column = i - start
      return { to: Math.min(lineStart + column, Math.max(lineStart, endOf(cs, lineStart) - 1)), inclusive: true, linewise: true }
    }
    case 'w':
    case 'W': {
      const big = key === 'W'
      // Vim's own exception: `cw` on a word changes to its end, not up to the
      // next — and the first count ends the word the cursor is on, which for a
      // one-character word is where the cursor already is.
      if (op === 'c' && kind(cs[i], big) !== 0) {
        let at = i
        const k = kind(cs[i], big)
        while (at + 1 < n && kind(cs[at + 1], big) === k) at++
        for (let c = 1; c < count; c++) at = wordEnd(cs, at, big)
        return { to: at, inclusive: true }
      }
      return { to: repeat((at) => wordStart(cs, at, big)), inclusive: false }
    }
    case 'e':
    case 'E':
      return { to: repeat((at) => wordEnd(cs, at, key === 'E')), inclusive: true }
    case 'b':
    case 'B':
      return { to: repeat((at) => wordBack(cs, at, key === 'B')), inclusive: false }
    case '0':
      return { to: start, inclusive: false }
    case '^':
      return { to: firstBlankless(cs, i), inclusive: false }
    case '$':
      return { to: Math.max(start, end - 1), inclusive: true }
    case 'gg':
      return { to: firstBlankless(cs, 0), inclusive: false, linewise: true }
    case 'G':
      return { to: firstBlankless(cs, lineAt(cs, lineCount(cs) - 1)), inclusive: false, linewise: true }
    case 'f':
    case 'F':
    case 't':
    case 'T':
    case ';':
    case ',': {
      let find: Find | null = char !== undefined ? { kind: key as Find['kind'], char } : state.lastFind
      if (!find) return null
      if (key === ',') {
        const reversed = { f: 'F', F: 'f', t: 'T', T: 't' } as const
        find = { kind: reversed[find.kind], char: find.char }
      }
      const pos = found(cs, i, find, count)
      if (pos === null) return null
      const remembered = key === ';' || key === ',' ? (state.lastFind ?? find) : find
      if (find.kind === 'f') return { to: pos, inclusive: true, find: remembered }
      if (find.kind === 't') return { to: pos - 1, inclusive: true, find: remembered }
      if (find.kind === 'F') return { to: pos, inclusive: false, find: remembered }
      return { to: pos + 1, inclusive: false, find: remembered }
    }
  }
  return null
}

const PAIRS: Readonly<Record<string, readonly [string, string]>> = {
  '(': ['(', ')'],
  ')': ['(', ')'],
  b: ['(', ')'],
  '[': ['[', ']'],
  ']': ['[', ']'],
  '{': ['{', '}'],
  '}': ['{', '}'],
  B: ['{', '}'],
}

/** `[start, end)` of a text object around the cursor, or null where there is none. */
function object(cs: readonly string[], i: number, key: string, around: boolean): [number, number] | null {
  const n = cs.length
  if (n === 0) return null
  if (key === 'w' || key === 'W') {
    const big = key === 'W'
    const k = kind(cs[i], big)
    let start = i
    let end = i + 1
    while (start > 0 && kind(cs[start - 1], big) === k) start--
    while (end < n && kind(cs[end], big) === k) end++
    if (!around) return [start, end]
    if (k === 0) {
      let stop = end
      const nk = kind(cs[stop], big)
      while (stop < n && kind(cs[stop], big) === nk && nk !== 0) stop++
      return [start, stop]
    }
    let trailing = end
    while (trailing < n && kind(cs[trailing], big) === 0) trailing++
    if (trailing > end) return [start, trailing]
    while (start > 0 && kind(cs[start - 1], big) === 0) start--
    return [start, end]
  }
  if (key === '"' || key === "'") {
    // A quote pair is on one line, as vim finds them.
    const lineStart = startOf(cs, i)
    const quotes = cs.slice(lineStart, endOf(cs, i)).flatMap((ch, at) => (ch === key ? [lineStart + at] : []))
    for (let q = 0; q + 1 < quotes.length; q += 2) {
      const open = quotes[q] ?? 0
      const close = quotes[q + 1] ?? 0
      if (i > close) continue
      if (!around) return [open + 1, close]
      // vim's `a"` takes the blanks after the pair, or before it where there are none.
      const blank = (at: number) => cs[at] === ' ' || cs[at] === '\t'
      let end = close + 1
      while (end < n && blank(end)) end++
      if (end > close + 1) return [open, end]
      let start = open
      while (start > lineStart && blank(start - 1)) start--
      return [start, close + 1]
    }
    return null
  }
  const pair = PAIRS[key]
  if (!pair) return null
  const [left, right] = pair
  let open = -1
  let depth = 0
  for (let j = i; j >= 0; j--) {
    if (cs[j] === right && j !== i) depth++
    else if (cs[j] === left) {
      if (depth === 0) {
        open = j
        break
      }
      depth--
    }
  }
  if (open === -1) return null
  depth = 0
  for (let j = open + 1; j < n; j++) {
    if (cs[j] === left) depth++
    else if (cs[j] === right) {
      if (depth === 0) return around ? [open, j + 1] : [open + 1, j]
      depth--
    }
  }
  return null
}

/** NORMAL's cursor sits on a character of its line, never on the newline past it unless the line is empty. */
function onCharacter(ed: LineEditor): LineEditor {
  const cs = [...ed.text]
  const i = indexOf(ed.text, ed.cursor)
  const start = startOf(cs, i)
  const end = endOf(cs, i)
  const index = Math.max(start, Math.min(i, end - 1))
  return { ...ed, cursor: offset(cs, index), last: null }
}

function operate(
  state: VimState,
  ed: LineEditor,
  op: Op,
  start: number,
  end: number,
  linewise = false,
): VimStep {
  const cs = [...ed.text]
  const from = offset(cs, start)
  const to = offset(cs, end)
  const register = ed.text.slice(from, to)
  const kept = { ...state, register, linewise }
  if (op === 'y') return { state: kept, editor: onCharacter({ ...ed, cursor: from }), effect: null }
  const removed = remove(ed, from, to)
  if (op === 'd') return { state: kept, editor: onCharacter(removed), effect: null }
  // What is typed next undoes together with what `c` took, as one change.
  const editor = from === to ? removed : { ...removed, last: 'insert' as const }
  return { state: { ...kept, mode: 'insert' }, editor, effect: null }
}

/**
 * Whole lines `first` to `last`, as `dd`, `dj` and `dG` take them. Deleting
 * takes a newline with them — the one after, or the one before the last line —
 * so no empty line is left where they were; changing keeps one to type on.
 */
function operateLines(state: VimState, ed: LineEditor, op: Op, first: number, last: number): VimStep {
  const cs = [...ed.text]
  const start = lineAt(cs, first)
  const end = endOf(cs, lineAt(cs, last))
  const register = cs.slice(start, end).join('')
  const kept = { ...state, register, linewise: true }
  // Yanking moves nothing, as in vim.
  if (op === 'y') return { state: kept, editor: { ...ed, last: null }, effect: null }
  if (op === 'c') {
    const removed = remove(ed, offset(cs, start), offset(cs, end))
    return { state: { ...kept, mode: 'insert' }, editor: { ...removed, last: 'insert' }, effect: null }
  }
  const [from, to] = end < cs.length ? [start, end + 1] : start > 0 ? [start - 1, end] : [start, end]
  const removed = remove(ed, offset(cs, from), offset(cs, to))
  const after = [...removed.text]
  const at = firstBlankless(after, Math.min(from, after.length))
  return { state: kept, editor: onCharacter({ ...removed, cursor: offset(after, at) }), effect: null }
}

function run(state: VimState, ed: LineEditor, command: Command): VimStep {
  const cs = [...ed.text]
  const n = cs.length
  const i = indexOf(ed.text, ed.cursor)
  const start = startOf(cs, i)
  const end = endOf(cs, i)
  const { count, op, action } = command
  const same: VimStep = { state, editor: ed, effect: null }
  const toInsert = (index: number): VimStep => ({
    state: { ...state, mode: 'insert' },
    editor: { ...ed, cursor: offset(cs, index), last: null },
    effect: null,
  })

  if (action.kind === 'line') {
    const line = lineOf(cs, i)
    return operateLines(state, ed, op ?? 'd', line, Math.min(lineCount(cs) - 1, line + count - 1))
  }
  if (action.kind === 'object') {
    const range = object(cs, i, action.key, action.around)
    return range && op ? operate(state, ed, op, range[0], range[1]) : same
  }
  if (action.kind === 'motion') {
    const t = target(cs, i, action.key, action.char, count, state, op)
    if (!t) {
      // `j` past the last line and `k` past the first are history, as ↓ and ↑.
      if (!op && (action.key === 'j' || action.key === 'k')) {
        return { ...same, effect: action.key === 'k' ? 'previous-history' : 'next-history' }
      }
      return same
    }
    const next = t.find ? { ...state, lastFind: t.find } : state
    if (!op) {
      const to = t.linewise ? t.to : Math.max(start, Math.min(t.to, Math.max(start, endOf(cs, t.to) - 1), n - 1))
      const clamped = Math.max(0, Math.min(to, n))
      return { state: next, editor: onCharacter({ ...ed, cursor: offset(cs, clamped), last: null }), effect: null }
    }
    if (t.linewise) {
      const here = lineOf(cs, i)
      const there = lineOf(cs, t.to)
      return operateLines(next, ed, op, Math.min(here, there), Math.max(here, there))
    }
    const [from, to] =
      t.to >= i ? [i, Math.min(n, t.inclusive ? t.to + 1 : t.to)] : [t.to, t.inclusive ? i + 1 : i]
    return operate(next, ed, op, from, to)
  }

  switch (action.key) {
    case 'i':
      return toInsert(i)
    case 'a':
      return toInsert(Math.min(end, i + 1))
    case 'I':
      return toInsert(firstBlankless(cs, i))
    case 'A':
      return toInsert(end)
    case 'o':
    case 'O': {
      const at = action.key === 'o' ? end : start
      const opened = insert({ ...ed, cursor: offset(cs, at), last: null }, '\n')
      const cursor = action.key === 'o' ? opened.cursor : offset(cs, at)
      return { state: { ...state, mode: 'insert' }, editor: { ...opened, cursor }, effect: null }
    }
    case 'x':
      return end === start ? same : operate(state, ed, 'd', i, Math.min(end, i + count))
    case 'D':
      return end === start ? same : operate(state, ed, 'd', i, end)
    case 'C':
      return operate(state, ed, 'c', i, end)
    case 'r': {
      if (i + count > end || action.char === undefined) return same
      const text = [...cs.slice(0, i), ...Array(count).fill(action.char), ...cs.slice(i + count)]
      return { ...same, editor: { ...replace(ed, text.join(''), offset(text, i + count - 1)), last: null } }
    }
    case '~': {
      if (end === start) return same
      const stop = Math.min(end, i + count)
      const toggled = cs.map((ch, at) =>
        at >= i && at < stop ? (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()) : ch,
      )
      return { ...same, editor: { ...replace(ed, toggled.join(''), offset(toggled, Math.min(end - 1, stop))), last: null } }
    }
    case 'J': {
      // "Join [count] lines, with a minimum of two": one space where each break
      // was, the next line's leading blanks dropped, the cursor on the join.
      let text = [...cs]
      let join = -1
      for (let c = 0; c < Math.max(1, count - 1); c++) {
        const lineEnd = endOf(text, join === -1 ? i : join)
        if (lineEnd >= text.length) break
        let next = lineEnd + 1
        while (next < text.length && /[ \t]/.test(text[next] ?? '')) next++
        const joins = lineEnd > startOf(text, lineEnd) && next < text.length && text[next] !== '\n'
        text = [...text.slice(0, lineEnd), ...(joins ? [' '] : []), ...text.slice(next)]
        join = lineEnd
      }
      if (join === -1) return same
      return { ...same, editor: { ...replace(ed, text.join(''), offset(text, join)), last: null } }
    }
    case 'p':
    case 'P': {
      if (state.register === '') return same
      if (state.linewise) {
        const block = Array(count).fill(state.register).join('\n')
        const at = action.key === 'p' ? end : start
        const put = insert({ ...ed, cursor: offset(cs, at), last: null }, action.key === 'p' ? `\n${block}` : `${block}\n`)
        const putStart = action.key === 'p' ? at + 1 : at
        const after = [...put.text]
        return { ...same, editor: { ...put, cursor: offset(after, firstBlankless(after, putStart)), last: null } }
      }
      const at = action.key === 'P' || end === start ? i : i + 1
      const put = insert({ ...ed, cursor: offset(cs, at), last: null }, state.register.repeat(count))
      const after = [...put.text]
      return { ...same, editor: { ...put, cursor: offset(after, indexOf(put.text, put.cursor) - 1), last: null } }
    }
    case 'u': {
      let undone = ed
      for (let c = 0; c < count; c++) undone = undo(undone)
      return { ...same, editor: onCharacter(undone) }
    }
    case '.': {
      let step: VimStep = same
      for (let c = 0; c < count; c++) step = replay(step.state, step.editor, state.lastChange)
      return step
    }
    case '/':
      return { ...same, effect: 'open-menu' }
  }
  return same
}

/** A key typed in NORMAL. The caller hands INSERT's keys to the readline line. */
export function vimKey(state: VimState, ed: LineEditor, key: string): VimStep {
  const keys = state.pending + key
  const parsed = parse(keys)
  if (parsed === null) return { state: { ...state, pending: '' }, editor: ed, effect: null }
  if (!parsed.done) return { state: { ...state, pending: keys }, editor: ed, effect: null }
  const step = run({ ...state, pending: '' }, ed, parsed)
  const { action, op } = parsed
  const simple = action.kind === 'simple' ? action.key : ''
  const changes = op === 'd' || op === 'c' || simple === 'r' || CHANGES.includes(simple || '_')
  if (!changes) return step
  const entersInsert = op === 'c' || ENTERS_INSERT.includes(simple || '_')
  if (entersInsert && step.state.mode === 'insert') return { ...step, state: { ...step.state, recording: keys } }
  return { ...step, state: { ...step.state, lastChange: keys } }
}

/** Esc from INSERT: back to NORMAL, a character left on the same line, as vim leaves it. In NORMAL it drops a half-typed command. */
export function vimEscape(state: VimState, ed: LineEditor): VimStep {
  if (state.mode === 'normal') return { state: { ...state, pending: '' }, editor: ed, effect: null }
  const lastChange = state.recording !== null ? `${state.recording}\x1b` : state.lastChange
  const cs = [...ed.text]
  const i = indexOf(ed.text, ed.cursor)
  const left = Math.max(startOf(cs, i), i - 1)
  return {
    state: { ...state, mode: 'normal', pending: '', recording: null, lastChange },
    editor: onCharacter({ ...ed, cursor: offset(cs, left) }),
    effect: null,
  }
}

/** What INSERT typed, kept so `.` can type it again. Backspace arrives as `\x7f`. */
export function vimTyped(state: VimState, keys: string): VimState {
  return state.recording === null ? state : { ...state, recording: state.recording + keys }
}

/**
 * An INSERT key `.` cannot type again — a motion, a kill, a completion. The
 * change it is part of is then not repeated at all, rather than repeated as a
 * different one.
 */
export function vimUntracked(state: VimState): VimState {
  return state.recording === null ? state : { ...state, recording: null, lastChange: '' }
}

/** Keys as a sequence across both modes — what `.` replays, and what the tests type. */
export function replay(state: VimState, ed: LineEditor, keys: string): VimStep {
  let step: VimStep = { state, editor: ed, effect: null }
  for (const key of keys) {
    if (step.state.mode === 'normal') {
      const next = vimKey(step.state, step.editor, key)
      step = { ...next, effect: next.effect ?? step.effect }
    } else if (key === '\x1b') {
      step = { ...vimEscape(step.state, step.editor), effect: step.effect }
    } else if (key === '\x7f') {
      step = { state: vimTyped(step.state, key), editor: edit(step.editor, 'backward-delete-char'), effect: step.effect }
    } else {
      step = { state: vimTyped(step.state, key), editor: insert(step.editor, key), effect: step.effect }
    }
  }
  return step
}
