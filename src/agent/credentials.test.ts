import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ambientFingerprint, envApiKey, envApiKeyName, hasAmbientCredentials } from './agent.js'

/**
 * What this layer can see: the environment, and the profile directory the
 * Anthropic CLI writes. Which of those wins over a stored key is the store's
 * side of the same question, and is tested in `src/cli/credentials.test.ts` —
 * the agent layer may not import the store, and `guard.sh` enforces that.
 */

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

describe('envApiKeyName', () => {
  test('names the variable actually providing the key', () => {
    process.env['ANTHROPIC_API_KEY'] = ''
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'token'
    expect(envApiKeyName()).toBe('ANTHROPIC_AUTH_TOKEN')
  })
})

describe('ambientFingerprint', () => {
  test('a profile replaced by a second sign-in reads as a change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tula-ant-'))
    await mkdir(join(dir, 'credentials'), { recursive: true })
    const profile = join(dir, 'credentials', 'default.json')
    await writeFile(profile, '{}')
    process.env['ANTHROPIC_CONFIG_DIR'] = dir

    const before = ambientFingerprint()
    await new Promise((done) => setTimeout(done, 10))
    await writeFile(profile, '{"replaced":true}')

    // Existence alone cannot see this, and the sign-in screen would report
    // success the moment it opened the browser.
    expect(ambientFingerprint()).not.toBe(before)
  })
})
