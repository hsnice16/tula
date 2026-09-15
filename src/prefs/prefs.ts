import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TulaError } from '../core/errors.js'
import { configDir } from '../core/paths.js'

/**
 * How somebody has set the shell up, kept across sessions: the one file later
 * preferences go in too. Its own file for the reason `src/update/state.ts`
 * gives — not `credentials.json`, whose module holds every key, and not
 * `state.json`, which is the update check's.
 *
 * A preference that cannot be read is the default, never a refusal to start:
 * nothing here protects anything, and a shell that will not open over a
 * keybinding costs the reader the book they opened it to read.
 */
export interface Preferences {
  /** Vim editing on the input line. Off unless turned on, as in every tool that ships it. */
  vim?: boolean
}

export const preferencesPath = (): string => join(configDir(), 'preferences.json')

export async function readPreferences(): Promise<Preferences> {
  try {
    const parsed: unknown = JSON.parse(await readFile(preferencesPath(), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return {}
    const vim = (parsed as Record<string, unknown>)['vim']
    return typeof vim === 'boolean' ? { vim } : {}
  } catch {
    return {}
  }
}

/**
 * Merged into what is there, and renamed into place so an interrupted write
 * leaves the old file. The temp is created exclusively and the directory
 * refused when others can write to it: a link planted at the temp's name would
 * otherwise be written through, into whatever file it points at.
 */
export async function writePreferences(change: Preferences): Promise<void> {
  const next = { ...(await readPreferences()), ...change }
  const dir = configDir()
  const path = preferencesPath()
  const temp = `${path}.${process.pid}.tmp`
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const mode = (await stat(dir)).mode & 0o777
  if (mode & 0o022) {
    throw new TulaError(
      `${dir} is mode ${mode.toString(8)}: anyone on this machine can write to it.\n` +
        `  Run: chmod 700 ${dir}`,
    )
  }
  try {
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true })
  }
}
