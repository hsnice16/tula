import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolved per call, not at import: tests and scratch runs redirect these with
 * the environment, and a module-load constant would freeze the real path.
 *
 * Here rather than in `secrets/store.ts` because the update state lives beside
 * the credentials and must not import the module that reads them — nothing in
 * `src/update/**` has any business being one import away from a venue key.
 */
export const configDir = (): string =>
  process.env['TULA_CONFIG_DIR'] ?? join(homedir(), '.config', 'tula')

/** The tree `install.sh` writes. `TULA_INSTALL_DIR` is the same name it reads. */
export const installDir = (): string =>
  process.env['TULA_INSTALL_DIR'] ?? join(homedir(), '.tula')

/** A banner line sits beside a 7-column mark; past this a path is wrapping. */
const MAX_PATH = 64

/**
 * A path as somebody reads it rather than as the filesystem spells it. The
 * absolute form of anything under $HOME is mostly the reader's own username,
 * which is noise on screen and the part they would have to redact before
 * pasting a screenshot into an issue.
 *
 * Stripped and capped because a directory name is somebody else's text as much
 * as a venue's error is: every byte but `/` and NUL is legal in one, ESC
 * included, and a repository or an archive can carry a directory named to
 * repaint whatever draws it. The head is what gets elided — a path identifies
 * itself by its tail.
 */
export const homeRelative = (path: string): string => {
  const home = homedir()
  const clean = path.replace(/[\p{Cc}\p{Cf}]+/gu, '')
  const short = clean === home ? '~' : clean.startsWith(`${home}/`) ? `~${clean.slice(home.length)}` : clean
  return short.length > MAX_PATH ? `…${short.slice(short.length - MAX_PATH + 1)}` : short
}
