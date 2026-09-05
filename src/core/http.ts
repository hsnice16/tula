import { TulaError } from './errors.js'

/**
 * Every outbound request goes through here, because nothing else bounds how
 * long one can take.
 *
 * A venue that accepts the connection and then goes quiet is not a rare case —
 * it is what a rate-limited exchange, a saturated public RPC and a half-open
 * NAT connection all look like. Left alone, one of them blocks `refresh()`
 * for as long as the OS is willing to wait: the shell spins with no way out but
 * Ctrl-C, and a one-shot `tula exposure` in a script does not return. That is
 * the silent failure the whole architecture exists to prevent — a venue that
 * fails must be *named*, and a venue that never answers has to fail to be named.
 */
export const REQUEST_TIMEOUT_MS = 15_000

/**
 * Errors are printed and sent to the model, and a URL somebody set themselves
 * carries their key in the path — Alchemy and Infura both put it there. The
 * host names the thing that failed without carrying the credential to reach it.
 */
export const host = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const tooSlow = (url: string, timeoutMs: number = REQUEST_TIMEOUT_MS): TulaError =>
  new TulaError(
    `${host(url)} did not answer within ${timeoutMs / 1000}s.\n` +
      '  It may be rate-limiting you, or down. Try /refresh in a moment.',
  )

/**
 * A release archive is tens of megabytes, and 15s of it is an ordinary slow
 * connection rather than a venue that has stopped answering. Kept here beside
 * the poll deadline so the two are read together and neither is a bare number
 * at its call site.
 */
export const DOWNLOAD_TIMEOUT_MS = 300_000

export async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  // Raced against a timer rather than left to the signal alone. `AbortSignal`
  // bounds the wait for a *response*, not the wait for a connection: measured
  // against a black-holed address, a 3s signal took 75s to fire because the OS
  // connect timeout got there first. An unreachable venue is the commonest hang
  // of the two, so the timer is what actually holds the deadline; the signal
  // still goes along to release the socket once the connection does resolve.
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(tooSlow(url, timeoutMs)), timeoutMs)
  })

  try {
    return await Promise.race([
      fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
      deadline,
    ])
  } catch (err) {
    // Named rather than re-thrown: an abort surfaces as `TimeoutError: The
    // operation was aborted`, which says nothing about which venue stopped
    // answering, or that waiting longer would not have helped.
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw tooSlow(url, timeoutMs)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
