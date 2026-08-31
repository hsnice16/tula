import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Signing in is delegated to the Anthropic CLI rather than reimplemented here.
 * `ant auth login` opens a browser, completes the exchange, and stores a profile
 * the SDK reads on its own — so tula never sees, handles, or stores a token.
 * Building a second OAuth client to hold one would be strictly worse.
 */
export const INSTALL_HINT = 'brew install anthropics/tap/ant'

export function antPath(): string | null {
  const names = process.platform === 'win32' ? ['ant.exe', 'ant.cmd'] : ['ant']
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null
}

export type SignInStart = { ok: true } | { ok: false; reason: string }

/**
 * Detached with stdio ignored: `ant` runs its own local callback listener, and
 * anything it printed would land on top of the Ink surface mid-render.
 */
export function startSignIn(): SignInStart {
  const bin = antPath()
  if (!bin) {
    return {
      ok: false,
      reason:
        'The Anthropic CLI is not installed, so there is nothing to open a browser.\n' +
        `  Install it with:  ${INSTALL_HINT}\n` +
        '  Then choose this again, or paste an API key instead.',
    }
  }
  try {
    const child = spawn(bin, ['auth', 'login'], { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
