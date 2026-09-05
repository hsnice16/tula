import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

export async function writeState(next: UpdateState): Promise<void> {
  try {
    await mkdir(configDir(), { recursive: true, mode: 0o700 })
    await writeFile(statePath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  } catch {
    // Deliberately silent — see the note above.
  }
}
