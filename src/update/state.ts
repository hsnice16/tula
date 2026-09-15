import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configDir } from '../core/paths.js'

/**
 * When tula last looked for a release, and which one it has already mentioned.
 *
 * Its own file, never `credentials.json`. That one is mode 600 and its module
 * is walled off from the agent layer; a timestamp has no business sharing a
 * file with venue keys, and writing to that file would mean importing the code
 * that reads them.
 *
 * Every failure here is swallowed. A version check that cannot write a
 * timestamp has to be a check that did not happen, not a session that did not
 * start — the reader opened tula to see what their positions are worth.
 */
export interface UpdateState {
  /** ISO 8601, from the last completed check — successful or not. */
  checkedAt?: string
  /** The version already announced, so the same one is not announced twice. */
  announced?: string
}

const statePath = (): string => join(configDir(), 'state.json')

export async function readState(): Promise<UpdateState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as UpdateState) : {}
  } catch {
    return {}
  }
}

/**
 * Written beside the file, created exclusively and renamed over it, and never
 * into a directory others can write to: `state.json` or its temp could
 * otherwise be a link, and the write would land in whatever it points at.
 */
export async function writeState(next: UpdateState): Promise<void> {
  const dir = configDir()
  const temp = `${statePath()}.${process.pid}.tmp`
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    if ((await stat(dir)).mode & 0o022) return
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temp, statePath())
  } catch {
    // Deliberately silent — see the note above.
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}
