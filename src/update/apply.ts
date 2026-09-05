import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { TulaError } from '../core/errors.js'
import { DOWNLOAD_TIMEOUT_MS, host, request } from '../core/http.js'
import { APP_VERSION, REPO_URL } from '../version.js'
import type { NativeInstall } from './channel.js'
import { isNewer } from './version.js'

const run = promisify(execFile)

/**
 * What this machine's build is called in a release. Mirrors `detect_target` in
 * `install.sh`, and is exported for the tests: they have to name the archive
 * they serve, and a second copy of this mapping there would agree with itself
 * while both disagreed with the release.
 */
export function target(): string {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : ''
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : ''
  if (!os || !arch) throw new TulaError(`tula has no build for ${process.platform}-${process.arch}.`)
  return `${os}-${arch}`
}

async function fetchBytes(url: string): Promise<Buffer> {
  // The signal `request` attaches stays on the body, so the venue-poll deadline
  // bounds the whole download too — and it threw out of `arrayBuffer()` as a
  // TimeoutError, past `request`'s own catch, which wraps the header race and
  // not the body read. `/update install` ended in a stack trace on any
  // connection that could not pull tens of megabytes inside 15s.
  const response = await request(url, {}, DOWNLOAD_TIMEOUT_MS)
  if (!response.ok) {
    throw new TulaError(
      `Could not download the update: ${host(url)} returned ${response.status}.\n` +
        `  Nothing was installed. Try /update again, or ${REPO_URL}/releases`,
    )
  }
  try {
    return Buffer.from(await response.arrayBuffer())
  } catch {
    throw new TulaError(
      `The download from ${host(url)} stopped part-way.\n` +
        '  Nothing was installed. Try /update install again.',
    )
  }
}

/**
 * Installs `version` and points the launcher at it, or installs nothing.
 *
 * The checks are `install.sh`'s, in the same order and for the same reasons:
 * this is the second way onto the same disk, and two paths that disagree about
 * what they will accept means the stricter one is decoration. What it cannot do
 * is check provenance — that needs the GitHub CLI, and the caller has to have
 * said so before getting here.
 */
export async function applyUpdate(version: string, into: NativeInstall): Promise<string> {
  if (!isNewer(version, APP_VERSION)) {
    throw new TulaError(`${version} is not newer than ${APP_VERSION}; nothing to do.`)
  }

  const archive = `tula-v${version}-${target()}.tar.gz`
  const base = `${REPO_URL}/releases/download/v${version}`
  const temp = await mkdtemp(join(tmpdir(), 'tula-update-'))

  try {
    const bytes = await fetchBytes(`${base}/${archive}`)
    const sums = (await fetchBytes(`${base}/checksums.txt`)).toString()

    const expected = sums
      .split('\n')
      .find((line) => line.trim().endsWith(` ${archive}`))
      ?.trim()
      .split(/\s+/)[0]
    if (!expected) {
      throw new TulaError(
        `${archive} is not listed in checksums.txt. Nothing was installed.\n` +
          `  Do not use this download. Report it: ${REPO_URL}/security`,
      )
    }

    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== expected) {
      throw new TulaError(
        `${archive} does not match its published checksum. Nothing was installed.\n` +
          `  expected ${expected}\n  got      ${actual}\n` +
          `  Do not use this download. Report it: ${REPO_URL}/security`,
      )
    }

    // Written out only now, and unpacked only after both checks pass, so an
    // archive that fails one never reaches the install tree at all.
    const dir = join(into.versions, version)
    await mkdir(dir, { recursive: true })
    const staged = join(temp, archive)
    await writeFile(staged, bytes)
    // Same reason as the `access` below: `run` rejects with a plain Error on a
    // missing tar or a non-zero exit, and `command.ts` rethrows anything that is
    // not a TulaError — so an unpack failure left the update as a stack trace.
    try {
      await run('tar', ['-xzf', staged, '-C', dir])
    } catch {
      throw new TulaError(
        `Could not unpack ${archive}. Nothing was installed.\n` +
          '  The download may be truncated, or tar may be missing. Try /update install again.',
      )
    }

    // `access` rather than `stat`, whose ENOENT would throw past the message
    // below as a stack trace — leaving the one archive that unpacks to nothing
    // as the only failure here that does not say what went wrong.
    const binary = join(dir, 'tula')
    try {
      await access(binary)
    } catch {
      throw new TulaError(`${archive} did not contain a tula binary.`)
    }

    // Renamed over rather than unlinked and remade: a link replaced in two
    // steps has a moment with nothing at the end of it, and that moment is
    // every shell on the machine finding no tula. `force` because a run that
    // died between these two lines would otherwise block every run after it.
    const link = `${into.launcher}.${process.pid}`
    await rm(link, { force: true })
    await symlink(binary, link)
    await rename(link, into.launcher)
    return binary
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
