import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { antPath, startSignIn } from './signin.js'

const saved = process.env['PATH']
afterEach(() => {
  process.env['PATH'] = saved
})

describe('finding the Anthropic CLI', () => {
  test('an executable named ant on PATH is found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tula-path-'))
    const bin = join(dir, 'ant')
    await writeFile(bin, '#!/bin/sh\nexit 0\n')
    await chmod(bin, 0o755)
    process.env['PATH'] = dir
    expect(antPath()).toBe(bin)
  })

  test('a non-executable file of the same name is not the CLI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tula-path-'))
    await writeFile(join(dir, 'ant'), 'not a program')
    await chmod(join(dir, 'ant'), 0o644)
    process.env['PATH'] = dir
    expect(antPath()).toBeNull()
  })

  test('an empty PATH finds nothing rather than throwing', () => {
    process.env['PATH'] = ''
    expect(antPath()).toBeNull()
  })
})

describe('starting sign-in', () => {
  test('without the CLI it names the way out instead of failing silently', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tula-path-'))
    process.env['PATH'] = dir
    const result = startSignIn()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('brew install anthropics/tap/ant')
    expect(result.reason).toContain('paste an API key')
  })
})
