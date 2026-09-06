import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { applyUpdate, target } from './apply.js'
import type { NativeInstall } from './channel.js'

const run = promisify(execFile)
const NEW = '9.9.9'

let root: string
let archive: Buffer
let into: NativeInstall
const realFetch = globalThis.fetch

/**
 * The network is faked rather than reached, for the reason `install-test.sh`
 * fakes it too: the thing under test is what happens when a download is wrong,
 * and a test that needs a hostile server to prove a refusal is a test nobody
 * runs. Everything else here is real — a real gzip, a real sha256, a real
 * symlink flipped on a real tree.
 */
function serve(body: (url: string) => Buffer | null) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    const found = body(url)
    return found
      ? // Content-Length because the real asset host sends one, and it is what
        // turns the progress callback's byte count into a percentage.
        new Response(new Uint8Array(found), {
          status: 200,
          headers: { 'content-length': String(found.length) },
        })
      : new Response('not found', { status: 404 })
  }) as typeof fetch
}

const sums = (bytes: Buffer, name: string) =>
  Buffer.from(`${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tula-apply-'))
  const build = join(root, 'build')
  await mkdir(build, { recursive: true })
  await writeFile(join(build, 'tula'), '#!/bin/sh\necho 9.9.9\n')
  await run('tar', ['-czf', join(root, 'a.tar.gz'), '-C', build, 'tula'])
  archive = await readFile(join(root, 'a.tar.gz'))

  // The tree as install.sh leaves it: one version, and a link pointing at it.
  const current = join(root, 'versions', '0.1.0')
  await mkdir(current, { recursive: true })
  await mkdir(join(root, 'bin'), { recursive: true })
  await writeFile(join(current, 'tula'), '')
  await symlink(join(current, 'tula'), join(root, 'bin', 'tula'))
  into = { versions: join(root, 'versions'), launcher: join(root, 'bin', 'tula') }
})

afterEach(async () => {
  globalThis.fetch = realFetch
  await rm(root, { recursive: true, force: true })
})

const name = () => `tula-v${NEW}-${target()}.tar.gz`
const stillOnOld = async () => (await readlink(into.launcher)).includes('0.1.0')

describe('applying an update', () => {
  test('installs the build and points the launcher at it', async () => {
    serve((url) =>
      url.endsWith('checksums.txt') ? sums(archive, name()) : url.endsWith(name()) ? archive : null,
    )
    await applyUpdate(NEW, into)
    expect(await readlink(into.launcher)).toBe(join(into.versions, NEW, 'tula'))
  })

  // The old build staying put is the whole reason going back is a link flip.
  test('leaves the version it replaced on disk', async () => {
    serve((url) =>
      url.endsWith('checksums.txt') ? sums(archive, name()) : url.endsWith(name()) ? archive : null,
    )
    await applyUpdate(NEW, into)
    expect(await readFile(join(into.versions, '0.1.0', 'tula'), 'utf8')).toBe('')
  })

  test('refuses an archive that does not match its checksum, and installs nothing', async () => {
    serve((url) =>
      url.endsWith('checksums.txt')
        ? sums(Buffer.from('a different file'), name())
        : url.endsWith(name())
          ? archive
          : null,
    )
    await expect(applyUpdate(NEW, into)).rejects.toThrow(/does not match its published checksum/)
    expect(await stillOnOld()).toBe(true)
  })

  test('refuses an archive that is not listed in checksums.txt at all', async () => {
    serve((url) =>
      url.endsWith('checksums.txt')
        ? sums(archive, 'tula-v9.9.9-some-other-target.tar.gz')
        : url.endsWith(name())
          ? archive
          : null,
    )
    await expect(applyUpdate(NEW, into)).rejects.toThrow(/not listed in checksums.txt/)
    expect(await stillOnOld()).toBe(true)
  })

  /**
   * `/releases/latest` skips pre-releases, so a pre-release build asking is
   * offered the newest stable — which can be behind it. Downgrading silently is
   * how somebody ends up reading a liquidation price from a build that was
   * replaced for getting it wrong.
   */
  /**
   * The download is tens of megabytes and used to arrive as one awaited
   * `arrayBuffer()`, so `/update install` held the spinner on `working` for the
   * whole of it — the same screen `install.sh` showed before it kept curl's
   * meter. The caller cannot report what it is never told.
   */
  test('reports the download as it arrives, not only when it finishes', async () => {
    serve((url) =>
      url.endsWith('checksums.txt') ? sums(archive, name()) : url.endsWith(name()) ? archive : null,
    )
    const seen: [number, number | null][] = []
    await applyUpdate(NEW, into, (received, total) => seen.push([received, total]))
    expect(seen.length).toBeGreaterThan(1)
    // Opens at zero, so the label is on screen before the first chunk lands.
    expect(seen[0]?.[0]).toBe(0)
    // Never goes backwards, and ends on the whole archive.
    const counts = seen.map(([n]) => n)
    expect([...counts].sort((a, b) => a - b)).toEqual(counts)
    expect(counts[counts.length - 1]).toBe(archive.length)
    // The total is the archive's own length, so a percentage means something.
    expect(seen[seen.length - 1]?.[1]).toBe(archive.length)
  })

  // A redirect to object storage does not always carry the length. The bytes
  // are still worth reporting; only the percentage is not available.
  test('reports bytes alone when the server sends no length', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('checksums.txt')) return new Response(sums(archive, name()))
      if (url.endsWith(name())) return new Response(new Uint8Array(archive))
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    const seen: [number, number | null][] = []
    await applyUpdate(NEW, into, (received, total) => seen.push([received, total]))
    expect(seen.every(([, total]) => total === null)).toBe(true)
    expect(seen[seen.length - 1]?.[0]).toBe(archive.length)
  })

  test('installs correctly when nobody is listening for progress', async () => {
    serve((url) =>
      url.endsWith('checksums.txt') ? sums(archive, name()) : url.endsWith(name()) ? archive : null,
    )
    await applyUpdate(NEW, into)
    expect(await readlink(into.launcher)).toBe(join(into.versions, NEW, 'tula'))
  })

  test('refuses to move to a version that is not newer', async () => {
    serve(() => null)
    await expect(applyUpdate('0.0.1', into)).rejects.toThrow(/not newer/)
    expect(await stillOnOld()).toBe(true)
  })

  test('refuses when the release has no build for this machine', async () => {
    serve((url) => (url.endsWith('checksums.txt') ? sums(archive, name()) : null))
    await expect(applyUpdate(NEW, into)).rejects.toThrow(/404/)
    expect(await stillOnOld()).toBe(true)
  })
})
