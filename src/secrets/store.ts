import type { Stats } from 'node:fs'
import { chmod, lstat, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ConnectorCredentials } from '../connectors/types.js'
import { TulaError } from '../core/errors.js'

/**
 * Nothing in this module may be reachable from the agent tool layer. Connectors
 * call it and return results; if a credential ever lands in a tool response it
 * is sent verbatim to the model provider. Import it from `src/connectors/**`
 * only — never from `src/agent/**`.
 *
 * What this file does not do is encrypt. A key kept beside the ciphertext
 * protects nothing, and a passphrase would break the one-shot commands that run
 * unattended, so the store is plain JSON that only the owner can read. The
 * security page states that outright; changing it here changes it there.
 */

const REQUIRED_MODE = 0o600

// Resolved per call, not at import: tests and scratch runs redirect the store
// with TULA_CONFIG_DIR, and a module-load constant would freeze the real path.
const configDir = (): string => process.env['TULA_CONFIG_DIR'] ?? join(homedir(), '.config', 'tula')
const credentialsPath = (): string => join(configDir(), 'credentials.json')

type Store = Record<string, ConnectorCredentials>

// Reserved top-level keys are not venues. Prefixed so a venue can never collide
// with one, and so listVenues() cannot accidentally offer them as connectors.
const PROVIDER_KEY = '__provider'
const PRICES_KEY = '__prices'

export class PermissionsTooOpenError extends TulaError {
  constructor(path: string, mode: number) {
    super(
      `${path} is mode ${mode.toString(8)}; expected 600. ` +
        `Run: chmod 600 ${path}`,
    )
  }
}

export class DirectoryTooOpenError extends TulaError {
  constructor(path: string, mode: number) {
    super(
      `${path} is mode ${mode.toString(8)}: anyone on this machine can write to it.\n` +
        '  A credential file only you can read is one anyone can still replace.\n' +
        `  Run: chmod 700 ${path}`,
    )
  }
}

export class NotARegularFileError extends TulaError {
  constructor(path: string) {
    super(
      `${path} is not a regular file.\n` +
        '  tula will not read credentials through a link, or write them through one.\n' +
        `  Inspect it, then remove it: ls -l ${path}`,
    )
  }
}

async function load(): Promise<Store> {
  const path = credentialsPath()

  let info: Stats
  try {
    info = await lstat(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }

  // lstat, not stat: through a symlink the mode check reads the *target's*
  // permissions, so a link planted here passes it and then takes the next write
  // wherever it points.
  if (info.isSymbolicLink() || !info.isFile()) throw new NotARegularFileError(path)

  // Refuse rather than warn: a group-readable key file on a shared box is
  // the same failure as no encryption at all.
  const mode = info.mode & 0o777
  if (mode !== REQUIRED_MODE) throw new PermissionsTooOpenError(path, mode)

  // A file only you can read, in a directory anyone can write to, is a file
  // anyone can replace. Write is the permission that matters — 755 leaves the
  // contents unreadable and nothing to substitute, so it is not refused.
  const dirMode = (await stat(configDir())).mode & 0o777
  if (dirMode & 0o022) throw new DirectoryTooOpenError(configDir(), dirMode)

  return JSON.parse(await readFile(path, 'utf8')) as Store
}

/**
 * Written beside the target and renamed over it. The rename is atomic, so an
 * interrupted write cannot leave a store truncated to nothing, and it *replaces*
 * whatever is at the path rather than writing through it.
 */
async function save(store: Store): Promise<void> {
  const path = credentialsPath()
  await mkdir(configDir(), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  // writeFile's mode applies only when it creates the file; chmod covers the
  // case where a previous run left one behind.
  await writeFile(temp, JSON.stringify(store, null, 2), { mode: REQUIRED_MODE })
  await chmod(temp, REQUIRED_MODE)
  await rename(temp, path)
}

export async function get(venueId: string): Promise<ConnectorCredentials | undefined> {
  return (await load())[venueId]
}

export async function put(venueId: string, creds: ConnectorCredentials): Promise<void> {
  const store = await load()
  store[venueId] = creds
  await save(store)
}

export async function remove(venueId: string): Promise<void> {
  const store = await load()
  if (!(venueId in store)) return
  delete store[venueId]
  await save(store)
}

export async function listVenues(): Promise<string[]> {
  return Object.keys(await load()).filter((key) => !key.startsWith('__'))
}

/**
 * The model provider's key. It lives in the same file under the same 600-mode
 * rule as venue credentials: one place to protect, one place to audit.
 */
export async function getProviderKey(): Promise<string | undefined> {
  const value = (await load())[PROVIDER_KEY]?.['anthropicApiKey']
  return value === '' ? undefined : value
}

export async function putProviderKey(apiKey: string): Promise<void> {
  await put(PROVIDER_KEY, { anthropicApiKey: apiKey })
}

/**
 * The chosen price source and, if it needs one, its key. One entry, not one per
 * provider: only one oracle runs per process, and a key for a source that is not
 * in use is a stored secret earning nothing. Switching therefore forgets the
 * previous key, and the connect screen says so.
 */
export async function getPriceSource(): Promise<{ provider: string; apiKey?: string } | undefined> {
  const row = (await load())[PRICES_KEY]
  const provider = row?.['provider']
  if (!provider) return undefined
  const apiKey = row?.['apiKey']
  return apiKey ? { provider, apiKey } : { provider }
}

export async function putPriceSource(provider: string, apiKey?: string): Promise<void> {
  await put(PRICES_KEY, apiKey ? { provider, apiKey } : { provider })
}

/** The path only — callers show it to the user; the contents never leave this module. */
export function locationHint(): string {
  return credentialsPath()
}
