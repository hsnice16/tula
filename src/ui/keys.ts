import { KEYMAP, type KeyAction } from './keymap.js'
import type { LineCommand } from './line.js'

export interface Typed {
  /** What to insert at the cursor. */
  text: string
  /** The chunk ended in a newline, so the line is being submitted. */
  submits: boolean
}

/**
 * A single-line field's reading of a chunk. A paste the terminal did not
 * bracket arrives as one chunk, so `key.return` is false even when it ends in a
 * newline — that trailing newline is the submit and must not land in the line.
 * Interior newlines become spaces so a multi-line paste stays one editable line.
 *
 * Order matters: strip the trailing newline first, then translate the rest. A
 * `.trimEnd()` after the translation also takes a typed space, and
 * `/shock ETH -20` can then not be typed at all.
 */
export function typed(chunk: string): Typed {
  const submits = /[\r\n]$/.test(chunk)
  const text = printable(chunk.replace(/[\r\n]+$/, '').replace(/[\r\n]+/g, ' '))
  return { text, submits }
}

/**
 * Tabs as spaces, and every other control character but a line break dropped.
 * A line is drawn to the terminal as it stands, and Ink passes OSC sequences
 * through, so a copied `ESC ] 52` would write the clipboard; a tab is measured
 * as one cell and drawn as up to eight, which breaks the frame.
 */
const printable = (text: string): string =>
  text.replace(/\t/g, '    ').replace(/(?!\n)\p{Cc}/gu, '')

/**
 * A bracketed paste, as the shell's line takes it: whole, its line breaks kept,
 * and never a submit. `\r\n` and a lone `\r` are made `\n`, as Codex's
 * `handle_paste` makes them, so a paste from a Windows file is not two breaks.
 */
export const pasted = (text: string): string => printable(text.replace(/\r\n?/g, '\n'))

/** The part of Ink's `Key` a line editor reads. */
export interface KeyPress {
  ctrl: boolean
  meta: boolean
  leftArrow: boolean
  rightArrow: boolean
  upArrow: boolean
  downArrow: boolean
  home: boolean
  end: boolean
  backspace: boolean
  delete: boolean
}

/** The part of Ink's `Key` the shell reads. Every other field is decoration. */
export interface ShellKey extends KeyPress {
  return: boolean
  shift: boolean
  escape: boolean
  tab: boolean
}

export type EditingCommand =
  | LineCommand
  | 'previous-history'
  | 'next-history'
  | 'reverse-search-history'
  | 'forward-search-history'

/** The commands that change the line itself, rather than which line it is. */
export const isLineCommand = (command: EditingCommand): command is LineCommand =>
  !command.endsWith('-history')

const EDITING = new Set<string>([
  'beginning-of-line', 'end-of-line', 'backward-char', 'forward-char', 'backward-word', 'forward-word',
  'backward-delete-char', 'delete-char', 'unix-word-rubout', 'backward-kill-word', 'kill-word',
  'unix-line-discard', 'kill-line', 'yank', 'transpose-chars', 'undo',
  'previous-history', 'next-history', 'reverse-search-history', 'forward-search-history',
])

/**
 * The ctrl and alt chords, read off the keymap rather than written out a second
 * time, so a chord bound here is a chord the `?` panel lists. Ink hands a ctrl
 * chord over as its letter with `ctrl` set: a byte from 1 to 26 is a letter,
 * and 0x1f is `_`, the form the kitty protocol sends ctrl+_ in. An alt chord is
 * ESC then its letter.
 */
function chords(): { ctrl: Record<string, KeyAction>; meta: Record<string, KeyAction> } {
  const ctrl: Record<string, KeyAction> = {}
  const meta: Record<string, KeyAction> = {}
  for (const entry of KEYMAP) {
    if (!entry.binding) continue
    for (const bytes of entry.binding.sends) {
      const code = bytes.length === 1 ? bytes.charCodeAt(0) : -1
      if (code >= 1 && code <= 26 && code !== 9 && code !== 10 && code !== 13) {
        ctrl[String.fromCharCode(code + 96)] = entry.binding.action
      } else if (code === 0x1f) {
        ctrl['_'] = entry.binding.action
      } else if (bytes.length === 2 && bytes[0] === '\x1b' && /[a-z]/.test(bytes[1] ?? '')) {
        meta[bytes[1] ?? ''] = entry.binding.action
      }
    }
  }
  return { ctrl, meta }
}

const { ctrl: CTRL, meta: META } = chords()

const editing = (action: KeyAction | undefined): EditingCommand | null =>
  action && EDITING.has(action) ? (action as EditingCommand) : null

/**
 * The Readline command a keypress names, or null for a key that is typing or
 * belongs to the screen rather than the line. The table and its sources are in
 * `tasks/field-report/07-readline-keys.md`.
 */
export function editingCommand(ch: string, key: KeyPress): EditingCommand | null {
  if (key.home) return 'beginning-of-line'
  if (key.end) return 'end-of-line'
  // ctrl+arrows are the word motions that need no terminal setting at all.
  if (key.leftArrow) return key.ctrl || key.meta ? 'backward-word' : 'backward-char'
  if (key.rightArrow) return key.ctrl || key.meta ? 'forward-word' : 'forward-char'
  if (key.upArrow) return 'previous-history'
  if (key.downArrow) return 'next-history'
  if (key.backspace) return key.meta ? 'backward-kill-word' : 'backward-delete-char'
  if (key.delete) return key.meta ? 'kill-word' : 'delete-char'
  // ctrl+_ is 0x1f, outside the range Ink reads as a ctrl letter, so a legacy
  // terminal's arrives as the raw byte with no modifier set.
  if (ch === '\x1f') return 'undo'
  if (key.ctrl) return editing(CTRL[ch])
  if (key.meta) return editing(META[ch])
  return null
}

/**
 * What a keypress asks of the shell, named as `src/ui/keymap.ts` names it — the
 * one classifier `app.tsx` reads its keys through, and the one the keymap's test
 * walks every listed key through. Null for a key that is typing.
 */
export function keyAction(ch: string, key: ShellKey): KeyAction | null {
  const enter = enterKey(ch, key)
  if (enter === 'submit' || enter === 'newline') return enter
  const command = editingCommand(ch, key)
  if (command) return command
  if (key.escape) return 'dismiss'
  if (key.tab) return 'complete'
  if (key.ctrl) return CTRL[ch] ?? null
  if (!key.meta && ch === '?') return 'show-keys'
  return null
}

/** What Enter with a modifier asks of the line. */
export type EnterKey = 'submit' | 'newline' | 'ignore'

/**
 * Whether a keypress is Enter, a key that inserts a newline, or neither (null).
 * The keys and their sources are in `tasks/field-report/11-multi-line-input.md`.
 *
 * - Shift, Alt and ctrl with Enter insert a newline. Ink reads kitty's
 *   `CSI 13;2u`, `ESC CR` and `CSI 13;5u` as `return` with the modifier set.
 * - ctrl+j is a line feed on a legacy terminal, which Ink names `enter` and not
 *   `return`, and its own key under the kitty protocol.
 * - tmux's `extended-keys` and xterm's modifyOtherKeys send a modified Enter as
 *   `CSI 27;m;13~`, which Ink does not parse and hands on as text. That form is
 *   read here, and any other `CSI 27;…~` is dropped rather than typed.
 */
export function enterKey(
  ch: string,
  key: KeyPress & { return: boolean; shift: boolean },
): EnterKey | null {
  if (key.return) return key.shift || key.meta || key.ctrl ? 'newline' : 'submit'
  if (ch === '\n' || (key.ctrl && ch === 'j')) return 'newline'
  const other = /^\[27;(\d+);(\d+)~$/.exec(ch)
  if (!other) return null
  if (other[2] !== '13') return 'ignore'
  return other[1] === '1' ? 'submit' : 'newline'
}
