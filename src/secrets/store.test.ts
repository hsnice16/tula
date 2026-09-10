import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as secrets from './store.js'

/**
 * The store is the one place a credential rests, so its refusals are the
 * product, not an edge case. Each test here is a way somebody else on the
 * machine could read or redirect the file.
 */

const saved = { ...process.env }
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tula-store-'))
  await chmod(dir, 0o700)
  process.env['TULA_CONFIG_DIR'] = dir
})

afterEach(async () => {
  process.env = { ...saved }
  await rm(dir, { recursive: true, force: true })
})

const path = () => join(dir, 'credentials.json')

describe('the store', () => {
  test('a missing file is empty, not an error', async () => {
    expect(await secrets.listVenues()).toEqual([])
  })

  test('round-trips a credential and leaves the file at 600', async () => {
    await secrets.put('kraken', { apiKey: 'k', apiSecret: 's' })
    expect(await secrets.get('kraken')).toEqual({ apiKey: 'k', apiSecret: 's' })
    expect(await secrets.listVenues()).toEqual(['kraken'])
    const { mode } = await Bun.file(path()).stat()
    expect(mode & 0o777).toBe(0o600)
  })

  test('reserved keys are not offered as venues', async () => {
    await secrets.putProviderKey('sk-test')
    await secrets.putPriceSource('coinmarketcap', 'cmc-key')
    expect(await secrets.listVenues()).toEqual([])
    expect(await secrets.getProviderKey()).toBe('sk-test')
  })

  test('signing out takes the key back out of the file', async () => {
    await secrets.put('kraken', { apiKey: 'k', apiSecret: 's' })
    await secrets.putProviderKey('sk-test')
    await secrets.removeProviderKey()
    expect(await secrets.getProviderKey()).toBeUndefined()
    // The venue it sat beside is untouched: /login is not a way to lose them.
    expect(await secrets.listVenues()).toEqual(['kraken'])
    expect(await readFile(path(), 'utf8')).not.toContain('sk-test')
  })

  test('a readable-by-others file is refused, not read', async () => {
    await secrets.put('kraken', { apiKey: 'k', apiSecret: 's' })
    await chmod(path(), 0o644)
    expect(secrets.listVenues()).rejects.toThrow(/mode 644/)
  })

  // The mode check follows a symlink and reports the target's permissions, so
  // without this a link planted in the config directory passes it and then
  // takes the next write to wherever it points.
  test('a symlink in place of the store is refused on read', async () => {
    const elsewhere = join(dir, 'elsewhere.json')
    await writeFile(elsewhere, '{}', { mode: 0o600 })
    await symlink(elsewhere, path())
    expect(secrets.listVenues()).rejects.toThrow(/not a regular file/)
  })

  test('a symlink in place of the store is refused before a write, not written through', async () => {
    const elsewhere = join(dir, 'elsewhere.json')
    await writeFile(elsewhere, '{}', { mode: 0o600 })
    await symlink(elsewhere, path())
    expect(secrets.put('kraken', { apiSecret: 'REAL' })).rejects.toThrow(/not a regular file/)
    expect(await readFile(elsewhere, 'utf8')).toBe('{}')
  })

  test('a config directory anyone can write to is refused', async () => {
    await secrets.put('kraken', { apiKey: 'k', apiSecret: 's' })
    await chmod(dir, 0o777)
    expect(secrets.listVenues()).rejects.toThrow(/anyone on this machine can write/)
  })

  // The refusal used to arrive only on a read. `load()` returns early when the
  // file does not exist, so the very first connect on a machine whose config
  // directory was already loose wrote the key into it and reported success —
  // and the store then locked the owner out of a secret already sitting there
  // for anyone to replace. The first write is the one that has to refuse.
  test('a config directory anyone can write to is refused before the first write', async () => {
    await chmod(dir, 0o777)
    expect(secrets.put('kraken', { apiKey: 'k', apiSecret: 's' })).rejects.toThrow(
      /anyone on this machine can write/,
    )
    await chmod(dir, 0o700)
    expect(await readdir(dir)).toEqual([])
  })

  // 755 leaves nothing to read and nothing to substitute, and is what a
  // hand-made ~/.config/tula usually ends up as. Refusing it would be noise.
  test('a merely readable config directory is allowed', async () => {
    await secrets.put('kraken', { apiKey: 'k', apiSecret: 's' })
    await chmod(dir, 0o755)
    expect(await secrets.listVenues()).toEqual(['kraken'])
  })

  test('a write leaves no temporary file behind', async () => {
    await secrets.put('kraken', { apiKey: 'k', apiSecret: 's' })
    await secrets.remove('kraken')
    expect((await readdir(dir)).filter((f) => f.includes('.tmp'))).toEqual([])
  })
})

/**
 * A venue holding one credential is a total short by whatever is in the other
 * wallet. These are about the second one: that it can be stored, that it stays
 * where it was put, that it can be told apart from the first, and that it never
 * becomes a copy of it.
 */
describe('a venue with more than one credential', () => {
  // Stand-ins, not addresses: what the store keeps is an opaque string, and a
  // real address in this repository is somebody's holdings.
  const hot = '0xAbCd'
  const cold = '0xBeeF'

  test('a second wallet is kept, not written over the first', async () => {
    await secrets.put('wallet', { address: hot })
    await secrets.put('wallet', { address: cold })
    expect((await secrets.listCredentials('wallet')).map((e) => e.credentials['address'])).toEqual([
      hot,
      cold,
    ])
  })

  // Attribution that reorders between sessions attributes a figure to the wrong
  // wallet, which is a wrong number wearing the right one's name.
  test('the order they were added in survives a reread', async () => {
    for (const address of [hot, cold, '0xFeed']) {
      await secrets.put('wallet', { address })
    }
    const first = await secrets.listCredentials('wallet')
    const second = await secrets.listCredentials('wallet')
    expect(second.map((e) => e.id)).toEqual(first.map((e) => e.id))
    expect(second.map((e) => e.credentials['address'])).toEqual([
      hot,
      cold,
      '0xFeed',
    ])
  })

  // Two entries for one account double every position it holds, which is worse
  // than the gap that having only one closed.
  test('the same credential twice is refused rather than stored twice', async () => {
    await secrets.put('wallet', { address: hot })
    expect(secrets.put('wallet', { address: hot })).rejects.toThrow(/already holds/)
    expect(await secrets.listCredentials('wallet')).toHaveLength(1)
  })

  test('one address in two checksum spellings is one address', async () => {
    await secrets.put('wallet', { address: hot })
    expect(secrets.put('wallet', { address: hot.toLowerCase() })).rejects.toThrow(/already holds/)
    expect(await secrets.listCredentials('wallet')).toHaveLength(1)
  })

  // The refusal is read off a screen and pasted into a support thread. An
  // address is public; the key beside it is the whole of what tula protects.
  test('the refusal names the address and never the secret', async () => {
    await secrets.put('kraken', { apiKey: 'public-id', apiSecret: 'REAL' }, 'main')
    await secrets.put('wallet', { address: hot }, 'cold storage')
    const keyed = secrets.put('kraken', { apiKey: 'public-id', apiSecret: 'REAL' })
    expect(keyed).rejects.toThrow(/main/)
    expect(keyed).rejects.not.toThrow(/REAL/)
    expect(secrets.put('wallet', { address: hot })).rejects.toThrow(hot)
  })

  // Names are the only handle the user has on an entry, so two entries under
  // one name is a removal that takes the wrong wallet.
  test('two entries under one name are refused', async () => {
    await secrets.put('wallet', { address: hot }, 'cold')
    expect(secrets.put('wallet', { address: cold }, 'Cold')).rejects.toThrow(/already has an entry/)
  })

  test('an entry with no name is still stored and still removable', async () => {
    const added = await secrets.put('wallet', { address: hot })
    expect(added.name).toBeUndefined()
    expect(await secrets.removeCredential('wallet', added.id)).toBe(true)
    expect(await secrets.listVenues()).toEqual([])
  })

  test('removing one credential leaves the others where they were', async () => {
    await secrets.put('wallet', { address: hot }, 'hot')
    await secrets.put('wallet', { address: cold }, 'cold')
    await secrets.put('wallet', { address: '0xDeaD' }, 'spare')
    expect(await secrets.removeCredential('wallet', 'cold')).toBe(true)
    expect((await secrets.listCredentials('wallet')).map((e) => e.name)).toEqual(['hot', 'spare'])
  })

  // By the entry, never by its place: removing the first shifts every index
  // after it, and the list the user was reading is not the list that is left.
  test('an entry is removed by what the user called it, not by where it sat', async () => {
    await secrets.put('wallet', { address: hot }, 'hot')
    await secrets.put('wallet', { address: cold }, 'cold')
    await secrets.removeCredential('wallet', 'hot')
    await secrets.put('wallet', { address: '0xDeaD' }, 'spare')
    expect(await secrets.removeCredential('wallet', hot.toLowerCase())).toBe(false)
    expect((await secrets.listCredentials('wallet')).map((e) => e.name)).toEqual(['cold', 'spare'])
  })

  test('removing the last credential disconnects the venue', async () => {
    await secrets.put('wallet', { address: hot }, 'hot')
    expect(await secrets.removeCredential('wallet', 'hot')).toBe(true)
    expect(await secrets.listVenues()).toEqual([])
    expect(await secrets.get('wallet')).toBeUndefined()
  })

  // A venue key left behind holding nothing is a venue every screen calls
  // connected and no command can read.
  test('a venue emptied of credentials is not offered as connected', async () => {
    await secrets.put('wallet', { address: hot })
    await secrets.put('kraken', { apiKey: 'k', apiSecret: 's' })
    await secrets.removeCredential('wallet', hot)
    expect(await secrets.listVenues()).toEqual(['kraken'])
  })

  test('an entry is found by its id, its name or its address alike', async () => {
    const added = await secrets.put('wallet', { address: hot }, 'cold storage')
    for (const ref of [added.id, 'COLD STORAGE', hot.toLowerCase()]) {
      expect((await secrets.findCredential('wallet', ref))?.id).toBe(added.id)
    }
    expect(await secrets.findCredential('wallet', 'nothing')).toBeUndefined()
  })

  // Two addresses are told apart by what they are for, not by their first four
  // characters — and never by anything the credential keeps secret.
  test('an entry is labelled by its name, then its address, and never by a key', async () => {
    const named = await secrets.put('wallet', { address: hot }, 'cold storage')
    const bare = await secrets.put('hyperliquid', { address: cold })
    const keyed = await secrets.put('kraken', { apiKey: 'public-id', apiSecret: 'REAL' })
    expect(secrets.credentialLabel(named)).toBe(`cold storage (${hot})`)
    expect(secrets.credentialLabel(bare)).toBe(cold)
    expect(secrets.credentialLabel(keyed)).toBe(keyed.id)
    expect(secrets.credentialLabel(keyed)).not.toContain('REAL')
  })

  // The failure: `put` appends, and the connect screen used to write over the
  // venue's whole list rather than the entry it meant. Rotating a key at the
  // venue and reconnecting has to leave the dead one gone and every sibling
  // exactly where it was.
  test('a rotated key leaves no copy of the dead one on disk', async () => {
    const live = await secrets.put('kraken', { apiKey: 'public-id', apiSecret: 'DEAD' }, 'main')
    await secrets.replaceCredential('kraken', live.id, {
      apiKey: 'public-id',
      apiSecret: 'ROTATED',
    })
    const held = await secrets.listCredentials('kraken')
    expect(held.map((e) => e.credentials)).toEqual([{ apiKey: 'public-id', apiSecret: 'ROTATED' }])
    // The handle survives the credential: a rotation is not a rename.
    expect(held[0]?.name).toBe('main')
    expect(await readFile(path(), 'utf8')).not.toContain('DEAD')
  })

  // Attribution is read off the order, so a replacement that moved to the end
  // would relabel every figure the other wallets contribute.
  test('a replaced entry stays where it sat, and its siblings are untouched', async () => {
    await secrets.put('wallet', { address: hot }, 'hot')
    const middle = await secrets.put('wallet', { address: cold }, 'cold')
    await secrets.put('wallet', { address: '0xFeed' }, 'spare')
    await secrets.replaceCredential('wallet', 'cold', { address: '0xNew' })
    expect((await secrets.listCredentials('wallet')).map((e) => e.credentials['address'])).toEqual([
      hot,
      '0xNew',
      '0xFeed',
    ])
    // A new credential is a new entry: the id that named the old one must not
    // go on naming what took its place.
    expect((await secrets.findCredential('wallet', middle.id))).toBeUndefined()
  })

  test('replacing an entry with an address a sibling already holds is refused', async () => {
    await secrets.put('wallet', { address: hot }, 'hot')
    await secrets.put('wallet', { address: cold }, 'cold')
    expect(secrets.replaceCredential('wallet', 'cold', { address: hot })).rejects.toThrow(
      /already holds/,
    )
    expect((await secrets.listCredentials('wallet')).map((e) => e.credentials['address'])).toEqual([
      hot,
      cold,
    ])
  })

  // Nothing is deleted on the way to finding out the ref was wrong: the whole
  // point of one write is that there is no half-done state to be left in.
  test('replacing an entry that is not there changes nothing and names what is', async () => {
    await secrets.put('wallet', { address: hot }, 'hot')
    const missed = secrets.replaceCredential('wallet', 'vault', { address: cold })
    expect(missed).rejects.toThrow(/nothing called/)
    expect(missed).rejects.toThrow(/hot/)
    expect((await secrets.listCredentials('wallet')).map((e) => e.credentials['address'])).toEqual([
      hot,
    ])
  })

  test('replacing one venue leaves every other one where it was', async () => {
    await secrets.put('wallet', { address: hot })
    await secrets.put('wallet', { address: cold })
    const key = await secrets.put('kraken', { apiKey: 'k', apiSecret: 's' })
    await secrets.replaceCredential('kraken', key.id, { apiKey: 'k2', apiSecret: 's2' })
    expect((await secrets.listCredentials('wallet')).map((e) => e.credentials['address'])).toEqual([
      hot,
      cold,
    ])
  })

  // A name is drawn in a table and returned in a tool result, so a newline in
  // one is a forged row and a long one pushes every column off the screen.
  test('a name is flattened to one line, and an unusable one is refused not truncated', async () => {
    const added = await secrets.put('wallet', { address: hot }, '  cold\n  storage  ')
    expect(added.name).toBe('cold storage')
    expect(secrets.put('wallet', { address: cold }, 'x'.repeat(41))).rejects.toThrow(/40/)
    expect(await secrets.listCredentials('wallet')).toHaveLength(1)
  })

  test('reserved keys stay single and are still not venues', async () => {
    await secrets.putProviderKey('sk-one')
    await secrets.putProviderKey('sk-two')
    await secrets.putPriceSource('coinmarketcap', 'cmc-key')
    await secrets.putPriceSource('coingecko')
    expect(await secrets.getProviderKey()).toBe('sk-two')
    expect(await secrets.getPriceSource()).toEqual({ provider: 'coingecko' })
    expect(await secrets.listVenues()).toEqual([])
    expect(secrets.put('__provider', { anthropicApiKey: 'sk-three' })).rejects.toThrow(/reserved/)
    expect(
      secrets.replaceCredential('__provider', 'x', { anthropicApiKey: 'sk-four' }),
    ).rejects.toThrow(/reserved/)
  })
})

/**
 * Every 0.1.x store on disk is the old shape. Nobody reconnects a venue to keep
 * it working, and a binary that reads the new shape as absent would offer to
 * take a credential it is already holding.
 */
describe('the shape on disk', () => {
  const oldShape = {
    __provider: { anthropicApiKey: 'sk-test' },
    kraken: { apiKey: 'k', apiSecret: 's' },
    wallet: { address: '0xAbCd' },
  }

  const write = async (contents: unknown) =>
    writeFile(path(), JSON.stringify(contents, null, 2), { mode: 0o600 })

  test('a store written by 0.1.x is read without anybody reconnecting', async () => {
    await write(oldShape)
    expect(await secrets.listVenues()).toEqual(['kraken', 'wallet'])
    expect(await secrets.get('kraken')).toEqual({ apiKey: 'k', apiSecret: 's' })
    expect(await secrets.getProviderKey()).toBe('sk-test')
    expect(await secrets.listCredentials('wallet')).toHaveLength(1)
  })

  test('migrating twice does not store the credential twice', async () => {
    await write(oldShape)
    await secrets.listVenues()
    await secrets.listVenues()
    const ids = (await secrets.listCredentials('kraken')).map((e) => e.id)
    expect(ids).toHaveLength(1)
    expect((await secrets.listCredentials('kraken')).map((e) => e.id)).toEqual(ids)
  })

  test('the migrating write leaves no temporary file and a file still at 600', async () => {
    await write(oldShape)
    await secrets.listVenues()
    expect((await readdir(dir)).filter((f) => f.includes('.tmp'))).toEqual([])
    const { mode } = await Bun.file(path()).stat()
    expect(mode & 0o777).toBe(0o600)
  })

  // Version 1 is inferred from a missing stamp, so the stamp has to be written
  // for a later reshape to have anything to refuse on.
  test('a written store carries the format version', async () => {
    await secrets.put('kraken', { apiKey: 'k', apiSecret: 's' })
    expect(JSON.parse(await readFile(path(), 'utf8'))['__version']).toBe(2)
  })

  test('a missing file is still not created by a read', async () => {
    expect(await secrets.listVenues()).toEqual([])
    expect(await readdir(dir)).toEqual([])
  })

  // Reading a newer file as empty would render a connected venue as
  // unconnected and offer to take the key again, which is the shape of a
  // phishing page. Refusing is the only safe way to be wrong here.
  test('a file from a newer tula is refused, not read as empty', async () => {
    await write({ __version: 99, wallet: [] })
    expect(secrets.listVenues()).rejects.toThrow(/newer tula/)
    expect(secrets.get('wallet')).rejects.toThrow(/newer tula/)
  })

  /**
   * The other direction, which no version stamp can enforce: a tula that shipped
   * before the stamp existed reads whatever it finds. What must not happen is
   * that it reads a venue it is holding a key for as *unconnected* and offers to
   * take the key again — a tool asking for a credential it already has is the
   * shape of a phishing page.
   *
   * An old binary is `Record<string, ConnectorCredentials>` and `get` is a
   * lookup, so what decides its behaviour is the shape under the venue's key.
   * That shape is what this pins; it is not the old binary running, which no
   * check here spawns.
   */
  test('a venue in a v2 file reads to an older tula as connected and empty, never as absent', async () => {
    await secrets.put('wallet', { address: '0xAbCd' })
    const file = JSON.parse(await readFile(path(), 'utf8')) as Record<string, unknown>

    // Its `listVenues` is the file's own keys, so the venue is still listed —
    // the reader is told they are connected, which they are.
    expect(Object.keys(file)).toContain('wallet')

    // Its `get` hands the connector this, and a list has none of the fields a
    // connector declares: the venue fails out loud rather than reading as
    // nothing stored. Both halves matter — an object here would be read as a
    // credential made of nothing.
    const asOldTulaSeesIt = file['wallet']
    expect(Array.isArray(asOldTulaSeesIt)).toBe(true)
    expect((asOldTulaSeesIt as Record<string, unknown>)['address']).toBeUndefined()
  })
})
