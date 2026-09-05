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
