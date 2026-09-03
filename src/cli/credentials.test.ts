import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as secrets from '../secrets/store.js'
import { credentialSource } from './commands.js'

/**
 * Which credential a question actually goes out with. Three places can hold
 * one, they do not agree, and every screen that names the credential names
 * this — so the order is the product, not an implementation detail.
 */

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

describe('credentialSource', () => {
  const store = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tula-store-'))
    await chmod(dir, 0o700)
    process.env['TULA_CONFIG_DIR'] = dir
  }

  const noProfile = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tula-ant-'))
    process.env['ANTHROPIC_CONFIG_DIR'] = dir
  }

  const withProfile = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tula-ant-'))
    await mkdir(join(dir, 'credentials'), { recursive: true })
    await writeFile(join(dir, 'credentials', 'default.json'), '{}')
    process.env['ANTHROPIC_CONFIG_DIR'] = dir
  }

  test('nothing anywhere is none', async () => {
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['ANTHROPIC_AUTH_TOKEN']
    await store()
    await noProfile()
    expect(await credentialSource()).toBe('none')
  })

  test('a stored key outranks a sign-in profile', async () => {
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['ANTHROPIC_AUTH_TOKEN']
    await store()
    await withProfile()
    await secrets.putProviderKey('sk-ant-stored')
    expect(await credentialSource()).toBe('stored')
    await secrets.removeProviderKey()
    expect(await credentialSource()).toBe('ambient')
  })

  test('the environment outranks the store, as index.ts resolves it', async () => {
    await store()
    await noProfile()
    await secrets.putProviderKey('sk-ant-stored')
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-env'
    expect(await credentialSource()).toBe('env')
  })
})
