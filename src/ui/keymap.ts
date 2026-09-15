import type { EditingCommand } from './keys.js'

/**
 * Every key the shell answers to, in one list. The `?` panel, `/keys`, the
 * section `README.md` carries between its markers and the site's keys page are
 * all drawn from here, and `keys.ts` builds its bindings from it — so a key
 * cannot work without being listed, and a list cannot name a key that does
 * nothing. `src/ui/keymap.test.ts` feeds each row's bytes through Ink's parser
 * and the handler to prove it. Grouped by what the keys are for, as Claude
 * Code's, Codex CLI's and Gemini CLI's references are:
 * `tasks/field-report/12-keys-reference.md` cites them.
 */

export type KeyGroup = 'general' | 'editing' | 'history' | 'lists' | 'multi-line' | 'vim'

export const KEY_GROUPS: readonly { id: KeyGroup; title: string }[] = [
  { id: 'general', title: 'General' },
  { id: 'editing', title: 'Editing' },
  { id: 'history', title: 'History' },
  { id: 'lists', title: 'Lists and suggestions' },
  { id: 'multi-line', title: 'More than one line' },
  { id: 'vim', title: 'Vim mode — after /vim' },
]

/** What a key names to the handler: a Readline command, or one of the shell's own. */
export type KeyAction =
  | EditingCommand
  | 'show-keys'
  | 'toggle-output'
  | 'clear-screen'
  | 'interrupt'
  | 'dismiss'
  | 'complete'
  | 'submit'
  | 'newline'

export interface KeyEntry {
  /** As the reader types them, one per way of pressing it. */
  readonly keys: readonly string[]
  readonly does: string
  readonly group: KeyGroup
  /** What limits the row — a terminal setting, a terminal that cannot send it. */
  readonly note?: string
  /**
   * For a row that is one keypress: what the handler must name, and the bytes a
   * terminal sends for each of `keys`, in the same order. A row without one is
   * held by a test that `src/ui/keymap.test.ts` names.
   */
  readonly binding?: { readonly action: KeyAction; readonly sends: readonly string[] }
}

const OPTION_AS_META = 'alt needs Option as Meta on macOS'

export const KEYMAP: readonly KeyEntry[] = [
  {
    keys: ['?'],
    does: 'Show or hide these keys, on an empty line',
    group: 'general',
    binding: { action: 'show-keys', sends: ['?'] },
  },
  {
    keys: ['/'],
    does: 'Open the command menu',
    group: 'general',
  },
  {
    keys: ['ctrl+s'],
    does: 'Search all commands; while searching history, go to a newer match',
    group: 'general',
    binding: { action: 'forward-search-history', sends: ['\x13'] },
  },
  {
    keys: ['ctrl+o'],
    does: 'Show all of a long output, or shorten it again',
    group: 'general',
    binding: { action: 'toggle-output', sends: ['\x0f'] },
  },
  {
    keys: ['ctrl+l'],
    does: 'Clear the screen',
    group: 'general',
    binding: { action: 'clear-screen', sends: ['\x0c'] },
  },
  {
    keys: ['ctrl+c'],
    does: 'Clear the line; on an empty line, leave tula',
    group: 'general',
    binding: { action: 'interrupt', sends: ['\x03'] },
  },
  {
    keys: ['ctrl+d'],
    does: 'Delete the character under the cursor; on an empty line, leave tula',
    group: 'general',
    binding: { action: 'delete-char', sends: ['\x04'] },
  },
  {
    keys: ['Esc'],
    does: 'Close a list, the command search or these keys; cancel removing a venue',
    group: 'general',
    binding: { action: 'dismiss', sends: ['\x1b'] },
  },

  {
    keys: ['Enter'],
    does: 'While something is running, save what you typed to run next',
    group: 'general',
  },
  {
    keys: ['Esc', 'ctrl+c'],
    does: 'Stop an answer while it is being written; ctrl+c clears what you typed first',
    group: 'general',
  },
  {
    keys: ['↑'],
    does: 'On an empty line, bring back the last line waiting to run, to edit it',
    group: 'general',
  },

  {
    keys: ['ctrl+a', 'Home'],
    does: 'Go to the start of the line',
    group: 'editing',
    binding: { action: 'beginning-of-line', sends: ['\x01', '\x1b[H'] },
  },
  {
    keys: ['ctrl+e', 'End'],
    does: 'Go to the end of the line',
    group: 'editing',
    binding: { action: 'end-of-line', sends: ['\x05', '\x1b[F'] },
  },
  {
    keys: ['ctrl+b', '←'],
    does: 'Move back one character',
    group: 'editing',
    binding: { action: 'backward-char', sends: ['\x02', '\x1b[D'] },
  },
  {
    keys: ['ctrl+f', '→'],
    does: 'Move forward one character',
    group: 'editing',
    binding: { action: 'forward-char', sends: ['\x06', '\x1b[C'] },
  },
  {
    keys: ['alt+b', 'ctrl+←', 'alt+←'],
    does: 'Move back one word',
    group: 'editing',
    note: OPTION_AS_META,
    binding: { action: 'backward-word', sends: ['\x1bb', '\x1b[1;5D', '\x1b[1;3D'] },
  },
  {
    keys: ['alt+f', 'ctrl+→', 'alt+→'],
    does: 'Move forward one word',
    group: 'editing',
    note: OPTION_AS_META,
    binding: { action: 'forward-word', sends: ['\x1bf', '\x1b[1;5C', '\x1b[1;3C'] },
  },
  {
    keys: ['ctrl+w'],
    does: 'Delete back to the previous space',
    group: 'editing',
    binding: { action: 'unix-word-rubout', sends: ['\x17'] },
  },
  {
    keys: ['alt+backspace'],
    does: 'Delete the word before the cursor',
    group: 'editing',
    note: OPTION_AS_META,
    binding: { action: 'backward-kill-word', sends: ['\x1b\x7f'] },
  },
  {
    keys: ['alt+d'],
    does: 'Delete the word after the cursor',
    group: 'editing',
    note: OPTION_AS_META,
    binding: { action: 'kill-word', sends: ['\x1bd'] },
  },
  {
    keys: ['ctrl+u'],
    does: 'Delete to the start of the line',
    group: 'editing',
    binding: { action: 'unix-line-discard', sends: ['\x15'] },
  },
  {
    keys: ['ctrl+k'],
    does: 'Delete to the end of the line; at its end, join the next line',
    group: 'editing',
    binding: { action: 'kill-line', sends: ['\x0b'] },
  },
  {
    keys: ['ctrl+y'],
    does: 'Put back what was last deleted',
    group: 'editing',
    binding: { action: 'yank', sends: ['\x19'] },
  },
  {
    keys: ['Delete'],
    does: 'Delete the character under the cursor',
    group: 'editing',
    binding: { action: 'delete-char', sends: ['\x1b[3~'] },
  },
  {
    keys: ['ctrl+t'],
    does: 'Swap the two characters around the cursor',
    group: 'editing',
    binding: { action: 'transpose-chars', sends: ['\x14'] },
  },
  {
    keys: ['ctrl+_'],
    does: 'Undo the last edit',
    group: 'editing',
    binding: { action: 'undo', sends: ['\x1f'] },
  },

  {
    keys: ['↑', 'ctrl+p'],
    does: 'Move up a line; on the top line, show the line you sent before',
    group: 'history',
    binding: { action: 'previous-history', sends: ['\x1b[A', '\x10'] },
  },
  {
    keys: ['↓', 'ctrl+n'],
    does: 'Move down a line; on the bottom line, show the next line you sent',
    group: 'history',
    binding: { action: 'next-history', sends: ['\x1b[B', '\x0e'] },
  },
  {
    keys: ['ctrl+r'],
    does: 'Search what you sent before — ctrl+r for older, Enter to run, Esc to edit, ctrl+g to cancel',
    group: 'history',
    binding: { action: 'reverse-search-history', sends: ['\x12'] },
  },

  {
    keys: ['↑ ↓', 'ctrl+p ctrl+n'],
    does: 'Move through an open list',
    group: 'lists',
  },
  {
    keys: ['Enter'],
    does: 'Run the highlighted command; in a list of choices for a command, put the choice on the line',
    group: 'lists',
  },
  {
    keys: ['Tab'],
    does: 'Put the highlighted command on the line; with no list open, accept the suggestion',
    group: 'lists',
    binding: { action: 'complete', sends: ['\t'] },
  },
  {
    keys: ['→', 'ctrl+f', 'ctrl+e'],
    does: 'At the end of the line, accept the suggestion shown after the cursor',
    group: 'lists',
  },
  {
    keys: ['alt+f'],
    does: 'Accept one word of the suggestion',
    group: 'lists',
    note: OPTION_AS_META,
  },

  {
    keys: ['Enter'],
    does: 'Send what you typed',
    group: 'multi-line',
    binding: { action: 'submit', sends: ['\r'] },
  },
  {
    keys: ['ctrl+j'],
    does: 'Start a new line — works in every terminal',
    group: 'multi-line',
    binding: { action: 'newline', sends: ['\n'] },
  },
  {
    keys: ['shift+Enter'],
    does: 'Start a new line',
    group: 'multi-line',
    note: 'needs a terminal that sends it — one with the kitty keyboard protocol, or tmux with extended-keys',
    binding: { action: 'newline', sends: ['\x1b[13;2u'] },
  },
  {
    keys: ['alt+Enter', 'ctrl+Enter'],
    does: 'Start a new line',
    group: 'multi-line',
    note: `${OPTION_AS_META}; ctrl+Enter needs a terminal that sends it`,
    binding: { action: 'newline', sends: ['\x1b\r', '\x1b[13;5u'] },
  },
  {
    keys: ['\\ then Enter'],
    does: 'Start a new line; the backslash is removed',
    group: 'multi-line',
  },

  {
    keys: ['Esc'],
    does: 'Switch to NORMAL mode; if a list is open, the first Esc closes it',
    group: 'vim',
  },
  {
    keys: ['i a', 'I A', 'o O'],
    does: 'Switch to INSERT mode: before or after the cursor, at the start or end of the line, or on a new line below or above',
    group: 'vim',
  },
  {
    keys: ['h l', 'j k'],
    does: 'Left and right; up and down a line, and to earlier or later lines you sent from the top or bottom line',
    group: 'vim',
  },
  {
    keys: ['w e b', 'W E B'],
    does: 'Move by word; the capitals count everything between spaces as one word',
    group: 'vim',
  },
  {
    keys: ['0 ^ $', 'gg G'],
    does: 'Go to the start, the first character or the end of the line; to the first or last line',
    group: 'vim',
  },
  {
    keys: ['f F t T', '; ,'],
    does: 'Jump to a character on the line; repeat the jump, or repeat it backwards',
    group: 'vim',
  },
  {
    keys: ['d c y', 'dd cc yy', 'D C'],
    does: 'Delete, change or copy as far as the next move goes; the whole line; to the end of the line',
    group: 'vim',
  },
  {
    keys: ['x r ~ J', 'p P'],
    does: 'Delete a character, replace it, switch its case, join lines; paste after or before',
    group: 'vim',
  },
  {
    keys: ['iw aw', 'i" a"', 'i( a(', 'i[ a[', 'i{ a{'],
    does: 'After d, c or y: inside or around a word, quotes or brackets',
    group: 'vim',
  },
  {
    keys: ['3dw', '.', 'u'],
    does: 'Repeat a command a number of times; repeat the last change; undo',
    group: 'vim',
  },
  {
    keys: ['/', '?'],
    does: 'Open the command menu; show these keys',
    group: 'vim',
  },
]

const entriesIn = (group: KeyGroup) => KEYMAP.filter((entry) => entry.group === group)

/**
 * The list as the `?` panel and `/keys` print it: grouped, the keys in a column
 * and what they do beside them. Vim's rows only while vim is on, since in the
 * default mode those letters are letters. `vimFirst` puts them at the top for
 * the panel, which shows only the rows that fit: with vim on, those are the
 * keys in use, and otherwise they are the ones cut.
 */
export function keysText(options: { vim: boolean; vimFirst?: boolean }): string {
  const listed = KEY_GROUPS.filter((g) => options.vim || g.id !== 'vim')
  const groups = options.vimFirst
    ? [...listed.filter((g) => g.id === 'vim'), ...listed.filter((g) => g.id !== 'vim')]
    : listed
  const rows = groups.flatMap((g) => entriesIn(g.id))
  const width = Math.max(...rows.map((entry) => entry.keys.join(' · ').length))
  return groups
    .map((g) =>
      [
        g.title,
        ...entriesIn(g.id).map((entry) => {
          const note = entry.note ? ` (${entry.note})` : ''
          return `  ${entry.keys.join(' · ').padEnd(width)}  ${entry.does}${note}`
        }),
      ].join('\n'),
    )
    .join('\n\n')
}

/** A Markdown table cell, so a key like `\` or `|` survives the table it is in. */
const cell = (text: string) => text.replace(/\|/g, '\\|')

/** The reference as `README.md` carries it between its markers, and as the site's page renders it. */
export function keysMarkdown(): string {
  return KEY_GROUPS.map((g) =>
    [
      `### ${g.title}`,
      '',
      '| Keys | Does |',
      '|---|---|',
      ...entriesIn(g.id).map((entry) => {
        const keys = entry.keys.map((k) => `\`${cell(k)}\``).join(', ')
        const note = entry.note ? ` — ${cell(entry.note)}` : ''
        return `| ${keys} | ${cell(entry.does)}${note} |`
      }),
    ].join('\n'),
  ).join('\n\n')
}

/**
 * The reference as data, for the site, which is a separate package and cannot
 * import this module. Written as JSON by `scripts/keys-doc.ts` rather than as a
 * module, so it is exactly what this returns: the site's formatter lays a
 * generated module out differently, and a check comparing the two would fail on
 * layout alone.
 */
export function keysJson(): string {
  const groups = KEY_GROUPS.map((g) => ({
    title: g.title,
    rows: entriesIn(g.id).map((entry) => ({
      keys: entry.keys,
      does: entry.does,
      ...(entry.note ? { note: entry.note } : {}),
    })),
  }))
  return `${JSON.stringify({ groups }, null, 2)}\n`
}
