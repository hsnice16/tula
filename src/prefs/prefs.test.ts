import { afterEach, beforeEach, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preferencesPath, readPreferences, writePreferences } from './prefs.js'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tula-prefs-'))
  await chmod(dir, 0o700)
  process.env['TULA_CONFIG_DIR'] = dir
})
afterEach(async () => {
  delete process.env['TULA_CONFIG_DIR']
  await rm(dir, { recursive: true, force: true })
})

test('a preference is kept, and merged into what is there', async () => {
  await writePreferences({ vim: true })
  expect(await readPreferences()).toEqual({ vim: true })
  await writePreferences({ vim: false })
  expect(JSON.parse(await readFile(preferencesPath(), 'utf8'))).toEqual({ vim: false })
})

test('an unreadable file is the default, never a refusal', async () => {
  await writeFile(preferencesPath(), '{not json')
  expect(await readPreferences()).toEqual({})
})

test('a link planted at the temp name is not written through', async () => {
  const target = join(dir, 'elsewhere')
  await writeFile(target, 'untouched')
  await symlink(target, `${preferencesPath()}.${process.pid}.tmp`)
  expect(writePreferences({ vim: true })).rejects.toThrow()
  expect(await readFile(target, 'utf8')).toBe('untouched')
})

test('a directory anyone can write to is refused', async () => {
  await chmod(dir, 0o777)
  expect(writePreferences({ vim: true })).rejects.toThrow('chmod 700')
  expect(await readPreferences()).toEqual({})
})
