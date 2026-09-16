import { afterEach, beforeEach, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readState, writeState } from './state.js'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tula-state-'))
  await chmod(dir, 0o700)
  process.env['TULA_CONFIG_DIR'] = dir
})
afterEach(async () => {
  delete process.env['TULA_CONFIG_DIR']
  await rm(dir, { recursive: true, force: true })
})

test('what is written is read back', async () => {
  await writeState({ announced: '0.3.0' })
  expect(await readState()).toEqual({ announced: '0.3.0' })
})

test('a link at state.json is replaced, not written through', async () => {
  const target = join(dir, 'elsewhere')
  await writeFile(target, 'untouched')
  await symlink(target, join(dir, 'state.json'))
  await writeState({ announced: '0.3.0' })
  expect(await readFile(target, 'utf8')).toBe('untouched')
  expect(await readState()).toEqual({ announced: '0.3.0' })
})

test('a directory anyone can write to is written nothing, silently', async () => {
  await chmod(dir, 0o777)
  await writeState({ announced: '0.3.0' })
  expect(await readState()).toEqual({})
})

test('an announced version that is not a string reads as none', async () => {
  await writeFile(join(dir, 'state.json'), JSON.stringify({ announced: 3, checkedAt: 'x' }))
  expect(await readState()).toEqual({})
})
