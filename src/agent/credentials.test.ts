import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envApiKey, hasAmbientCredentials } from './agent.js'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

describe('envApiKey', () => {
  test('a set-but-empty key is not a credential', () => {
    process.env['ANTHROPIC_API_KEY'] = ''
    process.env['ANTHROPIC_AUTH_TOKEN'] = ''
    expect(envApiKey()).toBeUndefined()
  })

  test('an empty key falls through to a real auth token', () => {
    process.env['ANTHROPIC_API_KEY'] = ''
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'token'
    expect(envApiKey()).toBe('token')
  })
})

describe('hasAmbientCredentials', () => {
  test('an ant auth login profile counts as a credential', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tula-ant-'))
    await mkdir(join(dir, 'credentials'), { recursive: true })
    await writeFile(join(dir, 'credentials', 'default.json'), '{}')
    process.env['ANTHROPIC_CONFIG_DIR'] = dir
    expect(hasAmbientCredentials()).toBe(true)
  })

  test('a config directory with no stored profile does not', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tula-ant-'))
    await mkdir(join(dir, 'credentials'), { recursive: true })
    process.env['ANTHROPIC_CONFIG_DIR'] = dir
    expect(hasAmbientCredentials()).toBe(false)
  })

  test('a missing config directory is not an error', () => {
    process.env['ANTHROPIC_CONFIG_DIR'] = join(tmpdir(), 'tula-does-not-exist')
    expect(hasAmbientCredentials()).toBe(false)
  })
})
