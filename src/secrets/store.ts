import { randomBytes } from 'node:crypto'
import type { Stats } from 'node:fs'
import { chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectorCredentials } from '../connectors/types.js'
import { TulaError } from '../core/errors.js'
import { configDir } from '../core/paths.js'
import { visible } from '../core/untrusted.js'

/**
 * Nothing in this module may be reachable from the agent tool layer: a
 * credential that lands in a tool response is sent verbatim to the model
 * provider. Never import it from `src/agent/**`, directly or through a module
 * that holds one — `scripts/guard.sh` fails the build on both.
 *
 * What does import it is the command and UI layers, and only they. They read a
 * credential and hand it to a connector as an argument; no connector opens the
 * store itself, and moving that read down into one would put every venue client
 * an import away from the file holding every key.
 *
 * What this file does not do is encrypt. A key kept beside the ciphertext
 * protects nothing, and a passphrase would break the one-shot commands that run
 * unattended, so the store is plain JSON that only the owner can read. The
 * security page states that outright; changing it here changes it there.
 */

const REQUIRED_MODE = 0o600

const credentialsPath = (): string => join(configDir(), 'credentials.json')

/**
 * A venue holds a list, because one person holds more than one wallet and a
 * store that keeps the last one connected reports a total short by whatever is
 * in the other. Insertion order is the order, and it survives a read, so a
 * figure attributed to the second wallet is attributed to the same wallet
 * tomorrow.
 */
export interface StoredCredential {
  /**
   * Stable for the life of the entry, and unaffected by a sibling being
   * removed. Removal takes one of these rather than an index: positions shift,
   * and the shifted list is one the user never saw.
   */
  readonly id: string
  /** What the user called it. Never derived from what the credential contains. */
  readonly name?: string
  readonly credentials: ConnectorCredentials
}

// Reserved top-level keys are not venues. Prefixed so a venue can never collide
// with one, and so listVenues() cannot accidentally offer them as connectors.
const RESERVED_PREFIX = '__'
const PROVIDER_KEY = '__provider'
const PRICES_KEY = '__prices'
const VERSION_KEY = '__version'

/**
 * Stamped on every write so a later reshape has something to refuse on. 0.1.x
 * shipped without it, which is why version 1 is inferred from its absence
 * rather than read, and why the binaries already out there meet a version-2
 * file with no idea what it is. What they do with it decided this shape: a
 * venue whose value is a list leaves `listVenues()` — plain `Object.keys()` —
 * still naming the venue, and hands the list where a credential was expected,
 * so the venue fails and the run exits non-zero. Loud, and specifically not the
 * failure that mattered: nothing renders as *not connected*, so nothing offers
 * to take a key the user already gave.
 */
const FORMAT_VERSION = 2

type StoredValue = number | ConnectorCredentials | StoredCredential[]
type Store = Record<string, StoredValue>

const entries = (value: StoredValue | undefined): StoredCredential[] | undefined =>
  Array.isArray(value) ? value : undefined

const fields = (value: StoredValue | undefined): ConnectorCredentials | undefined =>
  typeof value === 'object' && !Array.isArray(value) ? value : undefined

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

/**
 * Refusing beats reading the parts we recognise: a venue this build cannot see
 * in the file renders as not connected, and a tool offering to take a key it is
 * already holding is the shape of a phishing page.
 */
export class StoreTooNewError extends TulaError {
  constructor(path: string, version: number) {
    super(
      `${path} was written by a newer tula (format ${version}; this one reads ${FORMAT_VERSION}).\n` +
        '  Reading it would show venues you have connected as unconnected.\n' +
        '  Run: tula update install\n' +
        `  Or, to start over from nothing: mv ${path} ${path}.old`,
    )
  }
}

export class DuplicateCredentialError extends TulaError {
  constructor(venueId: string, existing: StoredCredential) {
    super(
      `${venueId} already holds this credential — ${credentialLabel(existing)}.\n` +
        '  A second entry for one account counts everything in it twice, which is\n' +
        '  worse than not having it, so nothing was added and nothing changed.',
    )
  }
}

/**
 * Two entries under one name cannot be told apart by the only handle the user
 * has, and a removal that guesses between them removes the wrong wallet.
 */
export class DuplicateNameError extends TulaError {
  constructor(venueId: string, name: string) {
    super(
      `${venueId} already has an entry called “${name}”.\n` +
        '  Names are how two of them are told apart, so pick another one.',
    )
  }
}

/**
 * Raised where a caller named an entry that is not there. The entries it does
 * hold are listed because the ref was typed from memory, and the list is what
 * turns a refusal into the next thing to type.
 */
export class NoSuchCredentialError extends TulaError {
  constructor(venueId: string, ref: string, existing: readonly StoredCredential[]) {
    super(
      `${venueId} has nothing called “${ref}”.\n` +
        `  It holds: ${existing.map(credentialLabel).join(', ') || 'nothing'}\n` +
        '  Name one of those instead.',
    )
  }
}

/**
 * A name is the user's own words rather than a venue's, so it is not the
 * untrusted text `SECURITY.md` bounds — but it is drawn in a table and returned
 * in a tool result, where a newline is a forged row and a long one pushes every
 * column off the screen. Bounded once, where it is written, so nothing that
 * reads it has to remember to.
 */
const MAX_NAME = 40

function cleanName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const name = visible(raw, ' ').replace(/\s+/g, ' ').trim()
  if (name === '') return undefined
  if (name.length > MAX_NAME) {
    throw new TulaError(
      `That name is ${name.length} characters, and ${MAX_NAME} is the most that fits beside a figure.\n` +
        '  Pick a shorter one — it is only a label, and nothing but you reads it.',
    )
  }
  return name
}

/**
 * What to call an entry on screen — in a total's attribution, in an
 * `INCOMPLETE` line, beside a removal. Here so there is one answer: the rule it
 * enforces is that a display name never comes out of a secret. An address is
 * the exception it is because an address is not one, and it is what a person
 * recognises a wallet by when they never named it.
 */
export function credentialLabel(entry: StoredCredential): string {
  const address = entry.credentials['address']
  if (entry.name && address) return `${entry.name} (${address})`
  if (entry.name) return entry.name
  return address ?? entry.id
}

/**
 * What to type to name this entry again — the shortest of the three things
 * `findCredential` matches on. Beside `credentialLabel` because the label is
 * what a screen shows and this is what it must tell the reader to type back,
 * and the two drifting apart is a command nobody can run off the screen that
 * offered it. Never derived from a secret, for the same reason.
 */
export function credentialRef(entry: StoredCredential): string {
  return entry.name ?? entry.credentials['address'] ?? entry.id
}

/**
 * Sameness is decided here rather than by each caller, because the cost of the
 * callers disagreeing is a doubled position. An address *is* the account
 * whichever checksum spelling it arrives in and whatever is stored beside it;
 * anything else is the fields it consists of.
 */
function identity(creds: ConnectorCredentials): string {
  const address = creds['address']
  if (address) return `address:${address.toLowerCase()}`
  return JSON.stringify(Object.entries(creds).sort(([a], [b]) => (a < b ? -1 : 1)))
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

  await refuseOpenDirectory()

  const raw = JSON.parse(await readFile(path, 'utf8')) as Store
  const stamped = raw[VERSION_KEY]
  const version = typeof stamped === 'number' ? stamped : 1
  if (version > FORMAT_VERSION) throw new StoreTooNewError(path, version)
  if (version === FORMAT_VERSION) return raw

  // On read, not on the next write: nobody reconnects a venue to keep it
  // working, and a store that waits for a write migrates on whichever command
  // happens to be a write — which for most people is none of them for weeks.
  const migrated = migrate(raw)
  await save(migrated)
  return migrated
}

/**
 * Idempotent because it is keyed on what the value already is: a venue holding
 * a list is left alone, so a second pass cannot wrap it again or append its own
 * contents to it. Reserved rows are single by definition and pass through.
 */
function migrate(raw: Store): Store {
  const out: Store = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith(RESERVED_PREFIX)) {
      if (key !== VERSION_KEY) out[key] = value
      continue
    }
    // A row too damaged to be credentials still becomes an entry rather than
    // vanishing: an empty one fails the venue out loud, and a missing one
    // reports the venue as never connected.
    out[key] = entries(value) ?? [entry(fields(value) ?? {})]
  }
  return out
}

function entry(credentials: ConnectorCredentials, name?: string): StoredCredential {
  // Random rather than derived: an id derived from the credential is an id
  // computed from a secret, and this one is shown on screen.
  const id = randomBytes(4).toString('hex')
  return name === undefined ? { id, credentials } : { id, name, credentials }
}

/**
 * A file only you can read, in a directory anyone can write to, is a file
 * anyone can replace. Write is the permission that matters — 755 leaves the
 * contents unreadable and nothing to substitute, so it is not refused.
 *
 * Checked before a write as well as before a read. `load()` returns early on
 * ENOENT, so the first `connect` on a machine whose config directory was
 * already loose used to save the key into it and report success — the refusal
 * arrived on the next read, with the credential already on disk.
 */
async function refuseOpenDirectory(): Promise<void> {
  const dir = configDir()
  const dirMode = (await stat(dir)).mode & 0o777
  if (dirMode & 0o022) throw new DirectoryTooOpenError(dir, dirMode)
}

/**
 * Written beside the target and renamed over it. The rename is atomic, so an
 * interrupted write cannot leave a store truncated to nothing, and it *replaces*
 * whatever is at the path rather than writing through it.
 */
async function save(store: Store): Promise<void> {
  const path = credentialsPath()
  await mkdir(configDir(), { recursive: true, mode: 0o700 })
  await refuseOpenDirectory()
  const temp = `${path}.${process.pid}.tmp`
  // Stamped here rather than by each caller, so there is no write that forgets
  // to — an unstamped file is indistinguishable from a 0.1.x one.
  const stamped: Store = { [VERSION_KEY]: FORMAT_VERSION }
  for (const [key, value] of Object.entries(store)) {
    if (key !== VERSION_KEY) stamped[key] = value
  }
  try {
    // writeFile's mode applies only when it creates the file; chmod covers the
    // case where a previous run left one behind.
    await writeFile(temp, JSON.stringify(stamped, null, 2), { mode: REQUIRED_MODE })
    await chmod(temp, REQUIRED_MODE)
    await rename(temp, path)
  } finally {
    // A failed rename leaves every credential in a file nothing reads and
    // nothing removes — so a later disconnect rewrites the real store while
    // the temp keeps the key the user believes they forgot.
    await rm(temp, { force: true })
  }
}

/** Insertion order, and empty for a venue with nothing stored. */
export async function listCredentials(venueId: string): Promise<StoredCredential[]> {
  return entries((await load())[venueId]) ?? []
}

/**
 * The entry the user pointed at, by its id, the name they gave it, or its
 * address — the three things they can see. Case-insensitive, because an address
 * is the same address in either checksum spelling and a name is not a password.
 */
export async function findCredential(
  venueId: string,
  ref: string,
): Promise<StoredCredential | undefined> {
  return match(await listCredentials(venueId), ref)
}

function match(list: readonly StoredCredential[], ref: string): StoredCredential | undefined {
  const wanted = ref.toLowerCase()
  return list.find(
    (e) =>
      e.id.toLowerCase() === wanted ||
      e.name?.toLowerCase() === wanted ||
      e.credentials['address']?.toLowerCase() === wanted,
  )
}

/**
 * The first entry only, so a venue holding two reads short here — which is the
 * whole of how a second wallet stayed out of a total. Nothing that reads a
 * venue may call it: `listCredentials` is what fetching, attributing and
 * forgetting all go through. What is left for it is the reserved rows, which
 * are single by definition.
 */
export async function get(venueId: string): Promise<ConnectorCredentials | undefined> {
  const value = (await load())[venueId]
  return entries(value)?.[0]?.credentials ?? fields(value)
}

function refuseReserved(venueId: string): void {
  if (venueId.startsWith(RESERVED_PREFIX)) {
    throw new TulaError(`"${venueId}" is a reserved key, not a venue.`)
  }
}

/**
 * The two ways one entry can collide with the set it is joining. Both are
 * refused rather than merged: a second entry for one account counts everything
 * in it twice, and two entries under one name cannot be told apart by the only
 * handle the user has.
 */
function refuseCollision(
  venueId: string,
  against: readonly StoredCredential[],
  creds: ConnectorCredentials,
  name: string | undefined,
): void {
  const wanted = identity(creds)
  const same = against.find((e) => identity(e.credentials) === wanted)
  if (same) throw new DuplicateCredentialError(venueId, same)
  if (name && against.some((e) => e.name?.toLowerCase() === name.toLowerCase())) {
    throw new DuplicateNameError(venueId, name)
  }
}

/**
 * Adds; it does not replace. Replacing is what kept a second wallet out of the
 * total, so it is not something a store may do on the strength of a venue id —
 * the screen asks which entry is meant and calls `replaceCredential` with it.
 */
export async function put(
  venueId: string,
  creds: ConnectorCredentials,
  name?: string,
): Promise<StoredCredential> {
  refuseReserved(venueId)
  const label = cleanName(name)
  const store = await load()
  const existing = entries(store[venueId]) ?? []
  refuseCollision(venueId, existing, creds, label)

  const added = label ? entry(creds, label) : entry(creds)
  store[venueId] = [...existing, added]
  await save(store)
  return added
}

/**
 * One named entry swapped for a new credential, in the place it already held —
 * what rotating a key at the venue means. Its siblings are untouched, and the
 * order survives, so a figure attributed to the second wallet yesterday is not
 * attributed to a different one today.
 *
 * One write rather than a remove and a put, because the two-step version has a
 * moment where the venue holds nothing and a step that can fail after the old
 * credential is already gone. An exchange shows a secret key once; there is no
 * getting it back from that moment.
 *
 * The new entry gets its own id: the old one names a credential that no longer
 * exists, and a rotation is not distinguishable here from a different account
 * being pointed at the same slot. `name` left undefined keeps what the entry
 * was called — the handle survives the credential.
 */
export async function replaceCredential(
  venueId: string,
  ref: string,
  creds: ConnectorCredentials,
  name?: string,
): Promise<StoredCredential> {
  refuseReserved(venueId)
  const label = cleanName(name)
  const store = await load()
  const existing = entries(store[venueId]) ?? []
  const target = match(existing, ref)
  if (!target) throw new NoSuchCredentialError(venueId, ref, existing)

  const others = existing.filter((e) => e.id !== target.id)
  const kept = label ?? target.name
  refuseCollision(venueId, others, creds, kept)

  const added = kept ? entry(creds, kept) : entry(creds)
  store[venueId] = existing.map((e) => (e.id === target.id ? added : e))
  await save(store)
  return added
}

/**
 * One entry, named the way the user sees it. The last one going is the venue
 * disconnecting, and the venue key goes with it — an empty list left behind is
 * a venue every surface calls connected and no command can read.
 */
export async function removeCredential(venueId: string, ref: string): Promise<boolean> {
  const store = await load()
  const existing = entries(store[venueId])
  if (!existing) return false

  const target = match(existing, ref)
  if (!target) return false

  const left = existing.filter((e) => e.id !== target.id)
  if (left.length === 0) delete store[venueId]
  else store[venueId] = left
  await save(store)
  return true
}

/** Everything stored for the venue — what disconnecting it means. */
export async function remove(venueId: string): Promise<void> {
  const store = await load()
  if (!(venueId in store)) return
  delete store[venueId]
  await save(store)
}

export async function listVenues(): Promise<string[]> {
  const store = await load()
  return Object.keys(store).filter(
    (key) => !key.startsWith(RESERVED_PREFIX) && (entries(store[key])?.length ?? 0) > 0,
  )
}

/** Reserved rows are one apiece, so they are set rather than added to. */
async function putReserved(key: string, value: ConnectorCredentials): Promise<void> {
  const store = await load()
  store[key] = value
  await save(store)
}

/**
 * The model provider's key. It lives in the same file under the same 600-mode
 * rule as venue credentials: one place to protect, one place to audit.
 */
export async function getProviderKey(): Promise<string | undefined> {
  const value = (await get(PROVIDER_KEY))?.['anthropicApiKey']
  return value === '' ? undefined : value
}

export async function putProviderKey(apiKey: string): Promise<void> {
  await putReserved(PROVIDER_KEY, { anthropicApiKey: apiKey })
}

export async function removeProviderKey(): Promise<void> {
  await remove(PROVIDER_KEY)
}

/**
 * The chosen price source and, if it needs one, its key. One entry, not one per
 * provider: only one oracle runs per process, and a key for a source that is not
 * in use is a stored secret earning nothing. Switching therefore forgets the
 * previous key, and the connect screen says so.
 */
export async function getPriceSource(): Promise<{ provider: string; apiKey?: string } | undefined> {
  const row = await get(PRICES_KEY)
  const provider = row?.['provider']
  if (!provider) return undefined
  const apiKey = row?.['apiKey']
  return apiKey ? { provider, apiKey } : { provider }
}

export async function putPriceSource(provider: string, apiKey?: string): Promise<void> {
  await putReserved(PRICES_KEY, apiKey ? { provider, apiKey } : { provider })
}

/** The path only — callers show it to the user; the contents never leave this module. */
export function locationHint(): string {
  return credentialsPath()
}
