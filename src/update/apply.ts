import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { TulaError } from '../core/errors.js'
import { DOWNLOAD_TIMEOUT_MS, host, request } from '../core/http.js'
import { APP_VERSION, REPO_URL, SITE_URL } from '../version.js'
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

/**
 * How far a download has got. `total` is null when the server sent no
 * `Content-Length`, which a redirect to object storage sometimes does.
 */
export type DownloadProgress = (received: number, total: number | null) => void

/** Ink repaints on every call, and a 21 MB body arrives in a few hundred chunks. */
const PROGRESS_EVERY_MS = 100

async function fetchBytes(url: string, onProgress?: DownloadProgress): Promise<Buffer> {
  // The signal `request` attaches stays on the body, so the venue-poll deadline
  // bounds the whole download too — and it threw out of `arrayBuffer()` as a
  // TimeoutError, past `request`'s own catch, which wraps the header race and
  // not the body read. `/update install` ended in a stack trace on any
  // connection that could not pull tens of megabytes inside 15s.
  // A release asset is served by a redirect to object storage, and this request
  // carries no credential. What lands is still checksummed before it is used.
  const response = await request(url, { redirect: 'follow' }, DOWNLOAD_TIMEOUT_MS)
  if (!response.ok) {
    throw new TulaError(
      `Could not download the update: ${host(url)} returned ${response.status}.\n` +
        `  Nothing was installed. Try /update again, or ${REPO_URL}/releases`,
    )
  }
  // Read in chunks rather than one `arrayBuffer()`, so the caller can say how
  // far along it is. `install.sh` shows curl's meter for the same reason: this
  // is tens of megabytes, and a screen that does not move during it reads as a
  // hang rather than as work.
  const total = Number(response.headers.get('content-length')) || null
  const body = response.body
  try {
    if (!body) return Buffer.from(await response.arrayBuffer())
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    let reported = 0
    onProgress?.(0, total)
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      const now = Date.now()
      if (now - reported >= PROGRESS_EVERY_MS) {
        reported = now
        onProgress?.(received, total)
      }
    }
    onProgress?.(received, total)
    return Buffer.concat(chunks)
  } catch {
    throw new TulaError(
      `The download from ${host(url)} stopped part-way.\n` +
        '  Nothing was installed. Try /update install again.',
    )
  }
}

/**
 * The three directories `install.sh`'s `check_dir` refuses, refused here on the
 * same argument it makes: this binary is the process that opens
 * `credentials.json`, so mode 600 on that file is worth nothing if somebody
 * else can replace what reads it. Write is the permission that matters, which
 * is why 755 passes — the same line `src/secrets/store.ts` draws.
 *
 * A directory that is not there yet is not a refusal; `applyUpdate` creates it
 * and sets the mode itself rather than leaving it to the ambient umask.
 */
async function refuseSharedDirectory(dir: string): Promise<void> {
  let info: Stats
  try {
    info = await stat(dir)
  } catch {
    return
  }

  if (info.mode & 0o022) {
    throw new TulaError(
      `${dir} can be written to by other users on this machine.\n` +
        '  Whoever can write there can replace the binary that reads your keys.\n' +
        '  Nothing was installed.\n' +
        `  Fix it:  chmod go-w ${dir}`,
    )
  }

  // uid rather than a name: `stat` gives the number, and resolving it to a name
  // means a passwd lookup for an account that is by definition not this one.
  const me = process.getuid?.()
  if (me !== undefined && info.uid !== me) {
    throw new TulaError(
      `${dir} is owned by uid ${info.uid}, not by you.\n` +
        '  tula will not install into a tree somebody else controls.\n' +
        '  Nothing was installed.\n' +
        `  Install it somewhere you own:  ${SITE_URL}/install/`,
    )
  }
}

/**
 * `mkdir` takes the ambient umask, so under a umask of 0 the tree holding this
 * binary is left writable by everyone — the state `refuseSharedDirectory`
 * refuses on the next run. install.sh sets the same three.
 */
async function removeGroupWrite(dir: string): Promise<void> {
  try {
    const mode = (await stat(dir)).mode & 0o7777
    if (mode & 0o022) await chmod(dir, mode & ~0o022)
  } catch {
    // install.sh swallows this too: a directory this process cannot chmod is
    // one it does not own, and that was already refused above.
  }
}

/**
 * Installs `version` and points the launcher at it, or installs nothing.
 *
 * Every check `install.sh` makes, this makes too: it is the second way onto the
 * same disk, and two paths that disagree about what they will accept means the
 * stricter one is decoration. That is `check_dir`'s two refusals over the
 * install, bin and version directories as well as the checksum, and the modes
 * install.sh sets afterwards. It refuses one thing more, first — a version that
 * is not newer, since `/releases/latest` skips pre-releases and would otherwise
 * offer a pre-release build a silent downgrade. What it cannot do is check
 * provenance: that needs the GitHub CLI, and the caller has to have said so
 * before getting here.
 *
 * That last gap is why no `.tula-sha256` receipt is written. install.sh reads a
 * matching receipt as *this script downloaded, verified and unpacked that
 * binary* and answers "already installed"; one written here would say it about
 * a binary nothing checked the provenance of, and re-running the install line
 * is what somebody does to repair a tree they suspect. The cost is that such a
 * run downloads again, which is what a repair is.
 */
export async function applyUpdate(
  version: string,
  into: NativeInstall,
  onProgress?: DownloadProgress,
): Promise<string> {
  if (!isNewer(version, APP_VERSION)) {
    throw new TulaError(`${version} is not newer than ${APP_VERSION}; nothing to do.`)
  }

  const root = dirname(into.versions)
  const bin = dirname(into.launcher)
  const dir = join(into.versions, version)
  // Before the download, where install.sh also puts it: tens of megabytes
  // fetched into a tree that is then refused is minutes spent on a refusal.
  for (const d of [root, bin, dir]) await refuseSharedDirectory(d)

  const archive = `tula-v${version}-${target()}.tar.gz`
  const base = `${REPO_URL}/releases/download/v${version}`
  const temp = await mkdtemp(join(tmpdir(), 'tula-update-'))

  try {
    // Only the archive is reported on. checksums.txt is 386 bytes; a meter for
    // it would be a flicker naming work that is already done.
    const bytes = await fetchBytes(`${base}/${archive}`, onProgress)
    const sums = (await fetchBytes(`${base}/checksums.txt`)).toString()

    const expected = sums
      .split('\n')
      .find((line) => line.trim().endsWith(` ${archive}`))
      ?.trim()
      .split(/\s+/)[0]
    // Shape-checked before it is printed. `expected` is bytes from a downloaded
    // file, `split(/\s+/)` does not split on ESC, and this message is drawn on
    // the terminal in the one case the checksum exists for — so an archive that
    // failed verification could otherwise repaint the line saying so. A sha256
    // is 64 hex characters; anything else is not a checksum to begin with.
    if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) {
      throw new TulaError(
        `${archive} is not listed in checksums.txt with a valid checksum. Nothing was installed.\n` +
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
    await mkdir(dir, { recursive: true })
    for (const d of [root, bin, dir]) await removeGroupWrite(d)
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
      throw new TulaError(
        `${archive} did not contain a tula binary. Nothing was installed.\n` +
          `  The archive is published wrong. Report it: ${REPO_URL}/issues`,
      )
    }
    // Set rather than inherited from the archive: `tar` applies the umask to
    // what it unpacks, so a umask of 077 leaves a binary the launcher points at
    // and nothing else on the machine can run.
    await chmod(binary, 0o755)

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
