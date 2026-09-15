import type { Stats } from 'node:fs'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TulaError } from '../core/errors.js'
import { configDir } from '../core/paths.js'
import { BIP39_ENGLISH } from './bip39.js'

/**
 * What was submitted on the shell's input line, kept across sessions.
 *
 * Its own file, and this module imports nothing from `src/secrets/`, for the
 * reason `src/update/state.ts` gives: writing a line somebody typed must not
 * mean being one import away from the file holding every venue key. `app.tsx`
 * is the only caller, and `scripts/guard.sh` fails the build on any other —
 * a connect screen that recorded what it was handed would be writing keys
 * into a second file nobody knows to protect.
 *
 * The line is typed on the same keyboard that pastes exchange keys, so this
 * keeps less than a shell does: a key pasted onto the wrong line is exactly
 * what must not become permanent here. `recordable` is that rule, and it is
 * applied again on every read, so a file written before a pattern existed does
 * not hand back what the pattern now refuses.
 */

/** bash's own default `HISTSIZE`, which `HISTFILESIZE` follows. */
export const HISTORY_LIMIT = 500

const REQUIRED_MODE = 0o600

export const historyPath = (): string => join(configDir(), 'history.jsonl')

/** The documented way to keep nothing, in the spelling `TULA_NO_UPDATE_CHECK` set. */
export const historyOff = (): boolean => process.env['TULA_NO_HISTORY'] === '1'

/**
 * `.githooks/scan-staged`'s credential patterns, as that script spells them,
 * so `src/history/history.test.ts` can hold the two lists to each other. The
 * address pattern is the one left out: an address is public, and naming the
 * wallet a question is about is most of what a line here is for.
 */
export const SCAN_STAGED: readonly { ere: string; ignoreCase: boolean }[] = [
  { ere: 'sk-ant-[A-Za-z0-9_-]{20,}', ignoreCase: false },
  { ere: 'sk_live_[A-Za-z0-9]{16,}', ignoreCase: false },
  { ere: 'rk_live_[A-Za-z0-9]{16,}', ignoreCase: false },
  { ere: 'AKIA[0-9A-Z]{16}', ignoreCase: false },
  { ere: 'gh[pousr]_[A-Za-z0-9]{30,}', ignoreCase: false },
  { ere: 'github_pat_[A-Za-z0-9_]{30,}', ignoreCase: false },
  { ere: 'xox[baprs]-[A-Za-z0-9-]{20,}', ignoreCase: false },
  { ere: 'AIza[0-9A-Za-z_-]{30,}', ignoreCase: false },
  { ere: '-----BEGIN [A-Z ]*PRIVATE KEY-----', ignoreCase: false },
  { ere: '(_auth(Token)?|_password)[[:space:]]*=?[[:space:]]*[^[:space:]]+', ignoreCase: true },
  { ere: '(0x)?[a-f0-9]{64}', ignoreCase: true },
  {
    ere: "(secret|passphrase|password|api[_-]?key|private[_-]?key|auth[_-]?token|access[_-]?token)[\"']?[[:space:]]*[:=][[:space:]]*[\"']?[A-Za-z0-9+/=_-]{20,}",
    ignoreCase: true,
  },
  { ere: "[\"']([a-z]{3,8} ){11,23}[a-z]{3,8}[\"']", ignoreCase: false },
]

const COMPILED = SCAN_STAGED.map(
  ({ ere, ignoreCase }) => new RegExp(ere.replaceAll('[[:space:]]', '\\s'), ignoreCase ? 'i' : ''),
)

/**
 * Two shapes the hook cannot use and a prompt can. A seed phrase pasted at a
 * prompt carries no quotes, and the hook needs them because prose fills a
 * repository. A Kraken secret or a Binance key carries no prefix and no name
 * beside it, and the hook cannot refuse a long unbroken run because hashes fill
 * a repository too. A line typed here holds neither prose in quotes nor hashes.
 *
 * The words are found anywhere in the line, since a phrase pasted after half a
 * question is the same phrase. The cost is a question that happens to run
 * twelve words of three to eight letters without a break goes unrecorded.
 */
const BARE_WORDS = /(^|\s)([a-z]{3,8} ){11,23}[a-z]{3,8}(\s|$)/
const LONG_RUN = /[A-Za-z0-9+/=_-]{32,}/g

/** The shortest phrase a wallet issues. */
const SEED_WORDS = 12

/**
 * A seed phrase however it was written out: a word a line, numbered,
 * capitalised, or between commas — each a form `BARE_WORDS` does not see once a
 * paste keeps its line breaks. Held to BIP-39's own list, so a long question of
 * ordinary words is still kept.
 */
function walletWords(text: string): boolean {
  let run = 0
  for (const token of text.toLowerCase().split(/[\s,;]+/)) {
    const word = token.replace(/^#?\d+[.):-]?/, '').replace(/[.:]$/, '')
    if (word === '') continue
    run = BIP39_ENGLISH.has(word) ? run + 1 : 0
    if (run >= SEED_WORDS) return true
  }
  return false
}
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function unbrokenSecret(text: string): boolean {
  for (const [run] of text.matchAll(LONG_RUN)) {
    if (ADDRESS.test(run)) continue
    if (/[A-Za-z]/.test(run) && /[0-9]/.test(run)) return true
  }
  return false
}

/**
 * A line starting with a space is not kept, as fish keeps none unasked and
 * bash's `ignorespace` and zsh's `HIST_IGNORE_SPACE` keep none when set — the
 * one way to type something that stays out of the file on purpose.
 */
export function recordable(line: string): boolean {
  if (/^\s/.test(line)) return false
  const text = line.trim()
  if (text === '') return false
  if (COMPILED.some((pattern) => pattern.test(text))) return false
  return !BARE_WORDS.test(text) && !walletWords(text) && !unbrokenSecret(text)
}

/**
 * The same three refusals `src/secrets/store.ts` makes, restated because this
 * module may not import that one: not through a link, not wider than 600, and
 * not in a directory anyone else can write to. Refused rather than repaired —
 * a file somebody else could read is a file that has already been readable.
 */
async function checked(path: string): Promise<boolean> {
  let info: Stats
  try {
    info = await lstat(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new TulaError(
      `${path} is not a regular file.\n` +
        '  tula will not read what you typed through a link, or write it through one.\n' +
        `  Inspect it, then remove it: ls -l ${path}`,
    )
  }
  const mode = info.mode & 0o777
  if (mode !== REQUIRED_MODE) {
    throw new TulaError(
      `${path} is mode ${mode.toString(8)}; expected 600.\n` +
        '  It holds what you typed into tula, so nobody else may read it.\n' +
        `  Run: chmod 600 ${path}`,
    )
  }
  await refuseOpenDirectory()
  return true
}

async function refuseOpenDirectory(): Promise<void> {
  const dir = configDir()
  const mode = (await stat(dir)).mode & 0o777
  if (mode & 0o022) {
    throw new TulaError(
      `${dir} is mode ${mode.toString(8)}: anyone on this machine can write to it.\n` +
        '  A history file only you can read is one anyone can still replace.\n' +
        `  Run: chmod 700 ${dir}`,
    )
  }
}

function parse(raw: string): string[] {
  const out: string[] = []
  for (const row of raw.split('\n')) {
    if (row === '') continue
    try {
      const value: unknown = JSON.parse(row)
      if (typeof value === 'string' && recordable(value)) out.push(value)
    } catch {
      // A torn last row from a write that was interrupted is one lost entry,
      // not a file that can no longer be read.
    }
  }
  return out
}

async function saved(): Promise<string[]> {
  const path = historyPath()
  if (!(await checked(path))) return []
  return parse(await readFile(path, 'utf8'))
}

/** The newest `HISTORY_LIMIT`, oldest first. Throws a `TulaError` naming the fix when the file is refused. */
export async function readHistory(): Promise<string[]> {
  if (historyOff()) return []
  return (await saved()).slice(-HISTORY_LIMIT)
}

const serialize = (entries: readonly string[]): string =>
  entries.map((entry) => `${JSON.stringify(entry)}\n`).join('')

/** Beside the target and renamed over it, as the credential store writes, so a link is replaced rather than written through. */
async function rewrite(entries: readonly string[]): Promise<void> {
  const path = historyPath()
  const temp = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temp, serialize(entries), { mode: REQUIRED_MODE })
    await chmod(temp, REQUIRED_MODE)
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true })
  }
}

/**
 * Adds a submitted line, unless it is not to be kept, repeats the newest entry,
 * or recording is off. Appended, so two shells open at once both keep what was
 * typed into them. Cutting the file back replaces it, and a line another shell
 * appends meanwhile is lost — so that waits until the file holds twice the cap.
 */
export async function recordHistory(line: string): Promise<void> {
  if (historyOff() || !recordable(line)) return
  const entry = line.trim()
  await mkdir(configDir(), { recursive: true, mode: 0o700 })
  await refuseOpenDirectory()
  const existed = await checked(historyPath())
  const entries = existed ? parse(await readFile(historyPath(), 'utf8')) : []
  if (entries.at(-1) === entry) return
  if (entries.length + 1 > 2 * HISTORY_LIMIT) {
    return rewrite([...entries, entry].slice(-HISTORY_LIMIT))
  }
  // O_NOFOLLOW so a link planted between the check and the open is refused by
  // the kernel rather than written through. The chmod is for a umask that
  // would have created it narrower than 600, which the next read refuses.
  const file = await open(
    historyPath(),
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
    REQUIRED_MODE,
  )
  try {
    if (!existed) await file.chmod(REQUIRED_MODE)
    await file.write(`${JSON.stringify(entry)}\n`)
  } finally {
    await file.close()
  }
}

/** Removes the file outright; returns how many entries it held. */
export async function clearHistory(): Promise<number> {
  const path = historyPath()
  let held = 0
  try {
    held = (await saved()).length
  } catch {
    // A refused file is still one somebody may want gone, and `rm` on a link
    // removes the link rather than what it points at.
  }
  await rm(path, { force: true })
  return held
}

/**
 * The nearest entry from `from`, walking `direction` (-1 is older), that
 * contains `query` and is not `unlike` — the match already on screen, so
 * stepping never stops on a second copy of the same line. -1 when none does.
 * Case-sensitive, as Readline's incremental search is.
 */
export function findInHistory(
  entries: readonly string[],
  query: string,
  from: number,
  direction: -1 | 1,
  unlike?: string,
): number {
  for (let at = from; at >= 0 && at < entries.length; at += direction) {
    const entry = entries[at]
    if (entry !== undefined && entry !== unlike && entry.includes(query)) return at
  }
  return -1
}
