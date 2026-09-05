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
