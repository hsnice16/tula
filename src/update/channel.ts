import { lstat, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { installDir } from '../core/paths.js'

export interface NativeInstall {
  /** `~/.tula/versions` — where a new build is unpacked. */
  versions: string
  /** `~/.tula/bin/tula` — the link a new build is pointed at. */
  launcher: string
}

/**
 * Whether this binary is one `install.sh` put here, and so whether tula may
 * move itself. Homebrew and npm keep their own record of what is installed, and
 * a binary that swapped itself underneath either of them leaves the package
 * manager reporting a version that is not running — the update equivalent of a
 * wrong number, which is the failure this whole project is organised against.
 *
 * The launcher must still be a link. `install.sh` refuses to overwrite a file
 * somebody put there themselves, because it may be a wrapper pinning a version
 * on purpose; nothing is gained by being less careful from in here.
 */
export async function nativeInstall(): Promise<NativeInstall | null> {
  const root = installDir()
  const versions = join(root, 'versions')
  const launcher = join(root, 'bin', 'tula')

  try {
    // Both sides resolved, not just the binary. `realpath` on the running file
    // is what gets past argv[0] being the launcher symlink; resolving the tree
    // as well is what keeps the comparison true on a machine where some parent
    // is itself a link — /var is one on every mac, and a raw string compare
    // reads `/private/var/…` and `/var/…` as two unrelated places.
    const running = await realpath(process.execPath)
    const tree = await realpath(versions)
    if (!running.startsWith(tree + sep)) return null
    if (!(await lstat(launcher)).isSymbolicLink()) return null
    return { versions, launcher }
  } catch {
    return null
  }
}

/** What to tell somebody who did not install with the script. */
export const OTHER_CHANNELS =
  'Installed with Homebrew or npm: brew upgrade tula, or npm install -g @hsnice16/tula'
