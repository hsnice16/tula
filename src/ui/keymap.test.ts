import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import parseKeypress, { nonAlphanumericKeys } from '../../node_modules/ink/build/parse-keypress.js'
import { keysDocs } from '../../scripts/keys-doc.js'
import { KEYMAP, type KeyEntry, keysText } from './keymap.js'
import { keyAction } from './keys.js'

/**
 * `use-input.js`'s own mapping from a parsed keypress to the `(input, key)` a
 * handler receives, restated: Ink does not export it, and a keymap proven
 * against the parser but not against this step would pass a key the handler
 * never sees.
 */
function asHandlerSees(bytes: string) {
  const k = parseKeypress(bytes)
  let input: string
  if (k.isKittyProtocol) input = k.isPrintable ? (k.text ?? k.name) : k.ctrl && k.name.length === 1 ? k.name : ''
  else if (k.ctrl) input = k.name ?? ''
  else input = k.sequence
  if (!k.isKittyProtocol && nonAlphanumericKeys.includes(k.name)) input = ''
  if (input.startsWith('\x1b')) input = input.slice(1)
  return {
    input,
    key: {
      upArrow: k.name === 'up',
      downArrow: k.name === 'down',
      leftArrow: k.name === 'left',
      rightArrow: k.name === 'right',
      home: k.name === 'home',
      end: k.name === 'end',
      return: k.name === 'return',
      escape: k.name === 'escape',
      tab: k.name === 'tab',
      backspace: k.name === 'backspace',
      delete: k.name === 'delete',
      ctrl: k.ctrl,
      meta: k.meta,
      shift: k.shift,
    },
  }
}

/** A row's name here: its group and its keys, which together are unique. */
const rowId = (entry: KeyEntry): string => `${entry.group}: ${entry.keys.join(' · ')}`

/**
 * The rows that are not one keypress — a vim command, a key that means one
 * thing in a list and another on the line — and the test that holds each, as
 * `file: title`. Kept here rather than on the row, which ships in the binary.
 */
const COVERED_BY: Readonly<Record<string, string>> = {
  'general: /': 'src/ui/screen.test.ts: enter runs the highlighted command, and tab is what completes it',
  'general: Enter': 'src/ui/screen.test.ts: a line typed while a command runs is queued',
  'general: Esc · ctrl+c': 'src/ui/screen.test.ts: Esc stops a question, and what was queued runs next',
  'general: ↑': 'src/ui/screen.test.ts: a line typed while a command runs is queued',
  'lists: ↑ ↓ · ctrl+p ctrl+n': 'src/ui/screen.test.ts: both lists move on ctrl+n and ctrl+p',
  'lists: Enter': 'src/ui/screen.test.ts: an argument list opens from Enter on /shock',
  'lists: → · ctrl+f · ctrl+e': 'src/ui/screen.test.ts: a suggestion from history is cut at the edge',
  'lists: alt+f': 'src/ui/screen.test.ts: a suggestion from history is cut at the edge',
  'multi-line: \\ then Enter': 'src/ui/screen.test.ts: a trailing backslash breaks the line',
  'vim: Esc': 'src/ui/screen.test.ts: Esc closes a list before it leaves INSERT',
  'vim: i a · I A · o O': 'src/ui/vim.test.ts: enters INSERT at its place',
  'vim: h l · j k': 'src/ui/vim.test.ts: j on the last line and k on the first walk history instead',
  'vim: w e b · W E B': "src/ui/vim.test.ts: describe('motions'",
  'vim: 0 ^ $ · gg G': "src/ui/vim.test.ts: describe('several lines'",
  'vim: f F t T · ; ,': "src/ui/vim.test.ts: describe('motions'",
  'vim: d c y · dd cc yy · D C': "src/ui/vim.test.ts: describe('operators'",
  'vim: x r ~ J · p P': "src/ui/vim.test.ts: describe('operators'",
  'vim: iw aw · i" a" · i( a( · i[ a[ · i{ a{': "src/ui/vim.test.ts: describe('text objects'",
  'vim: 3dw · . · u': "src/ui/vim.test.ts: describe('counts, repeat and undo'",
  'vim: / · ?': 'src/ui/screen.test.ts: Esc closes a list before it leaves INSERT',
}

describe('every key the list names does what the list says', () => {
  test('each row is named once', () => {
    const ids = KEYMAP.map(rowId)
    expect(ids.filter((id, at) => ids.indexOf(id) !== at)).toEqual([])
  })

  test('each row is a keypress the handler names, or a row a test holds', () => {
    for (const entry of KEYMAP) {
      const id = rowId(entry)
      expect({ id, held: Boolean(entry.binding) !== id in COVERED_BY }).toEqual({ id, held: true })
    }
  })

  test('every covered row is a row the keymap has', () => {
    const ids = new Set(KEYMAP.map(rowId))
    expect(Object.keys(COVERED_BY).filter((id) => !ids.has(id))).toEqual([])
  })

  // The bytes a terminal sends, through Ink's parser and the handler's own
  // classifier: a row whose key reaches the handler as something else fails.
  test('each keypress, byte for byte as a terminal sends it, names the row’s action', () => {
    for (const entry of KEYMAP) {
      if (!entry.binding) continue
      expect({ keys: entry.keys, sends: entry.binding.sends.length }).toEqual({
        keys: entry.keys,
        sends: entry.keys.length,
      })
      entry.binding.sends.forEach((bytes, at) => {
        const { input, key } = asHandlerSees(bytes)
        expect({ key: entry.keys[at], action: keyAction(input, key) }).toEqual({
          key: entry.keys[at],
          action: entry.binding?.action ?? null,
        })
      })
    }
  })

  test('a row held by a test names a test that exists', () => {
    for (const covered of Object.values(COVERED_BY)) {
      const [file = '', title = ''] = covered.split(': ')
      expect({ file, exists: existsSync(file) }).toEqual({ file, exists: true })
      expect({ title, named: readFileSync(file, 'utf8').includes(title) }).toEqual({ title, named: true })
    }
  })

  // In the default mode those letters are letters.
  test('vim’s rows are listed only while vim is on', () => {
    expect(keysText({ vim: false })).not.toContain('Vim mode')
    expect(keysText({ vim: true })).toContain('Vim mode')
  })

  test('no newline key is claimed to work in every terminal but ctrl+j', () => {
    for (const entry of KEYMAP.filter((e) => e.binding?.action === 'newline')) {
      const everywhere = entry.does.includes('every terminal')
      expect({ keys: entry.keys, everywhere }).toEqual({ keys: entry.keys, everywhere: entry.keys.includes('ctrl+j') })
      if (!entry.keys.includes('ctrl+j')) expect(entry.note).toBeDefined()
    }
  })
})

describe('the published reference is the keymap', () => {
  test('README.md’s section and the site’s keys data are what the keymap renders', () => {
    for (const doc of keysDocs()) {
      expect({ path: doc.path, current: doc.now === doc.want }).toEqual({ path: doc.path, current: true })
    }
  })
})

/**
 * Keys the prose names by hand, held to the keymap in the shape
 * `src/site-claims.test.ts` holds commands and chains: a key named anywhere
 * that no row lists, or mentions, fails the build.
 */
describe('every key named in prose is one the keymap holds', () => {
  const CHORD = /\b(?:ctrl|alt|shift)\+(?:backspace|enter|[a-z_/]|[←→↑↓])/gi
  const held = new Set(
    KEYMAP.flatMap((entry) =>
      [...entry.keys, entry.does, entry.note ?? ''].flatMap((text) =>
        [...text.matchAll(CHORD)].map((m) => m[0].toLowerCase()),
      ),
    ),
  )

  const SURFACES = [
    'site/components/Session.tsx',
    'site/app/security/page.tsx',
    'src/ui/app.tsx',
    'src/ui/Palette.tsx',
    'AGENTS.md',
    'README.md',
  ] as const

  test('the keymap holds some chords, so the sweep runs over something', () => {
    expect(held.size).toBeGreaterThan(20)
  })

  for (const path of SURFACES) {
    test(`${path} names no key the keymap does not hold`, () => {
      const named = [...readFileSync(path, 'utf8').matchAll(CHORD)].map((m) => m[0].toLowerCase())
      expect([...new Set(named.filter((chord) => !held.has(chord)))]).toEqual([])
    })
  }
})
