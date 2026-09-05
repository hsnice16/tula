import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { REPO_URL } from '../version.js'
import { target } from './apply.js'
import { update } from './command.js'

const run = promisify(execFile)
const NEW = '9.9.9'

let root: string
const realFetch = globalThis.fetch
const realExecPath = process.execPath
const setExecPath = (to: string) => {
  Object.defineProperty(process, 'execPath', { value: to, configurable: true })
}

/**
 * A release GitHub is offering, and an archive whose checksum matches it.
 *
 * `latestRelease` reads the version off where the redirect landed, and a
 * constructed `Response` has an empty `url` — so the resolved address is set on
 * the instance. Faking the redirect rather than the JSON API is the point:
 * the API is what `check.ts` deliberately does not call.
 */
async function publish(): Promise<void> {
  const build = join(root, 'build')
  await mkdir(build, { recursive: true })
  await writeFile(join(build, 'tula'), '#!/bin/sh\n')
  await run('tar', ['-czf', join(root, 'a.tar.gz'), '-C', build, 'tula'])
  const archive = await readFile(join(root, 'a.tar.gz'))
  const name = `tula-v${NEW}-${target()}.tar.gz`
  const sums = `${createHash('sha256').update(archive).digest('hex')}  ${name}\n`

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.endsWith('/releases/latest')) {
      const landed = new Response(null, { status: 200 })
      Object.defineProperty(landed, 'url', { value: `${REPO_URL}/releases/tag/v${NEW}` })
      return landed
    }
    if (url.endsWith('checksums.txt')) return new Response(sums, { status: 200 })
    if (url.endsWith(name)) return new Response(new Uint8Array(archive), { status: 200 })
    return new Response('no', { status: 404 })
  }) as typeof fetch
}

/** The tree install.sh leaves, with this process running from inside it. */
async function nativeTree(): Promise<void> {
  const dir = join(root, 'versions', '0.1.0')
  await mkdir(dir, { recursive: true })
  await mkdir(join(root, 'bin'), { recursive: true })
  const binary = join(dir, 'tula')
  await writeFile(binary, '')
  await symlink(binary, join(root, 'bin', 'tula'))
  setExecPath(binary)
}

const linkedVersion = async () => readlink(join(root, 'bin', 'tula'))

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tula-cmd-'))
  process.env['TULA_INSTALL_DIR'] = root
})

afterEach(async () => {
  globalThis.fetch = realFetch
  setExecPath(realExecPath)
  delete process.env['TULA_INSTALL_DIR']
  await rm(root, { recursive: true, force: true })
})

describe('/update', () => {
  test('the fake release is actually offered, or nothing below tests anything', async () => {
    await nativeTree()
    await publish()
    expect((await update([])).output).toContain(NEW)
  })

  /**
   * The version reaching `applyUpdate` becomes a directory name and part of a
   * URL. It is read off a redirect, which is the one input on this path that
   * does not come from us, so its shape is checked rather than assumed.
   */
  test('a tag that is not a release number is no answer at all', async () => {
    await nativeTree()
    await publish()
    const offering = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (!url.endsWith('/releases/latest')) return offering(input as never, init as never)
      const landed = new Response(null, { status: 200 })
      Object.defineProperty(landed, 'url', { value: `${REPO_URL}/releases/tag/v../../etc` })
      return landed
    }) as typeof fetch

    const { output } = await update(['install'])
    expect(output).toContain('newest release')
  })

  test('rejects a subcommand it does not have, rather than guessing', async () => {
    const result = await update(['yes'])
    expect(result.failed).toBe(true)
    expect(result.output).toContain('/update install')
  })

  /**
   * The point of the whole command. `/update` on its own must not be able to
   * write anything: it is what somebody types to find out, and finding out is
   * not consenting.
   */
  test('with no second word it installs nothing, though a release is there', async () => {
    await nativeTree()
    await publish()
    const before = await linkedVersion()
    const result = await update([])
    expect(result.failed).toBeUndefined()
    expect(await linkedVersion()).toBe(before)
  })

  // A checksum cannot prove a release is one this project meant to publish.
  // Somebody reading the tag is the only check there is for that, so the plan
  // has to hand them the address rather than imply the download settled it.
  test('the plan names the release to check, and what is not checked', async () => {
    await nativeTree()
    await publish()
    const { output } = await update([])
    expect(output).toContain(`${REPO_URL}/releases/tag/v${NEW}`)
    expect(output).toContain('Who built it')
  })

  test('the second word is what installs it', async () => {
    await nativeTree()
    await publish()
    await update(['install'])
    expect(await linkedVersion()).toBe(join(root, 'versions', NEW, 'tula'))
  })

  /**
   * Under Homebrew or npm it declines even when asked outright: a binary that
   * swapped itself leaves the package manager naming a version that is not
   * running.
   */
  test('refuses to move a build it did not install, even with the second word', async () => {
    await nativeTree()
    const elsewhere = join(root, 'elsewhere', 'tula')
    await mkdir(join(root, 'elsewhere'), { recursive: true })
    await writeFile(elsewhere, '')
    setExecPath(elsewhere)
    await publish()

    const before = await linkedVersion()
    const { output } = await update(['install'])
    expect(output).toContain('brew upgrade tula')
    expect(await linkedVersion()).toBe(before)
  })
})
