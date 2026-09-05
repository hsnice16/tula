import { request } from '../core/http.js'
import { APP_VERSION, REPO_URL } from '../version.js'
import { readState, writeState } from './state.js'
import { isNewer } from './version.js'

/** Once a day. Often enough to hear about a release, rare enough to be nothing. */
const EVERY_MS = 24 * 60 * 60 * 1000

/**
 * A release number and nothing else. What comes back becomes a directory name
 * and part of a URL, so its shape is checked rather than assumed: this reads a
 * redirect, which is the one input on this path that does not come from us.
 */
const RELEASE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export interface Available {
  version: string
  /** The release page for this exact tag, for the reader to check themselves. */
  release: string
}

/**
 * The newest published release, or null.
 *
 * Read from the redirect rather than the JSON API, which `install.sh` avoids
 * for the same reason: the API rate-limits unauthenticated callers by IP, so an
 * office behind one NAT would see checks start failing for no reason anybody
 * could diagnose. This is a GET of a public page carrying nothing about the
 * caller — no version, no identifier, no query string — so what GitHub learns
 * is what it learns from somebody opening the releases page in a browser.
 */
async function latestRelease(): Promise<string | null> {
  try {
    const response = await request(`${REPO_URL}/releases/latest`)
    // A repository with nothing published redirects to the release list, which
    // has no tag in it and is correctly no answer.
    const tag = /\/tag\/v?([^/]+)\/?$/.exec(response.url)?.[1]
    return tag && RELEASE.test(tag) ? tag : null
  } catch {
    return null
  }
}

const offer = (version: string | null): Available | null =>
  version && isNewer(version, APP_VERSION)
    ? { version, release: `${REPO_URL}/releases/tag/v${version}` }
    : null

/**
 * What the reader should be told at startup, if anything. Silence is the answer
 * to every failure: no network, an unreachable GitHub, an unreadable state file.
 * Nobody opened tula to find out about tula.
 *
 * `announced` is what keeps this from nagging. A version is mentioned once;
 * after that it is on the reader, and `/update` is always there.
 */
export async function pendingUpdate(now = Date.now()): Promise<Available | null> {
  if (process.env['TULA_NO_UPDATE_CHECK']) return null

  const state = await readState()
  const last = state.checkedAt ? Date.parse(state.checkedAt) : 0
  if (Number.isFinite(last) && now - last < EVERY_MS) return null

  // The time is recorded whether or not there was an answer, so an unreachable
  // GitHub costs one attempt a day rather than one per start.
  const found = offer(await latestRelease())
  const said = found && state.announced !== found.version
  await writeState({
    ...state,
    checkedAt: new Date(now).toISOString(),
    ...(said ? { announced: found.version } : {}),
  })
  return said ? found : null
}

/** The same question `/update` asks, without the once-a-day gate in the way. */
export async function availableNow(): Promise<Available | null> {
  return offer(await latestRelease())
}
