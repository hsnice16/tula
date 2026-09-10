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

/**
 * Its own class so a caller with a second node to try can say so in its own
 * words — "the Base node did not answer" rather than a bare host — and still
 * tell a timeout apart from a refusal without matching on the text.
 */
export class TooSlow extends TulaError {}

const tooSlow = (url: string, timeoutMs: number = REQUEST_TIMEOUT_MS): TooSlow =>
  new TooSlow(
    `${host(url)} did not answer within ${timeoutMs / 1000}s.\n` +
      '  It may be rate-limiting you, or down. Try /refresh in a moment.',
  )

/**
 * Bun says `UnexpectedRedirect fetching "<url>"`; Node throws `fetch failed`
 * and puts `unexpected redirect` on the cause. Both are matched rather than
 * either, because the tests run under one runtime and the binary ships the
 * other, and a miss here would surface as a bare TypeError.
 */
const isRedirect = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false
  const cause = err.cause
  const causeText = cause instanceof Error ? cause.message : String(cause ?? '')
  // Both phrases in full, not the bare word: Node puts the failing hostname in
  // its cause, so matching `redirect` alone reported a DNS failure against a
  // host with that string in its name as a possible interception — advice to
  // distrust the network, given for a typo.
  return /unexpectedredirect/i.test(err.message.replace(/\s+/g, '')) ||
    /unexpected redirect/i.test(causeText)
}

/**
 * A cross-origin redirect is refused rather than followed because `fetch`
 * strips `Authorization` across one and nothing else: `X-MBX-APIKEY`,
 * `API-Key` and `X-CMC_PRO_API_KEY` would all be re-sent to whatever host the
 * `Location` names. Anything able to shape a venue's response — an intercepting
 * proxy, a rogue CA, an open redirect at the venue's edge — could then collect
 * the key by answering `302`. SECURITY.md calls that the highest-severity
 * failure there is, so it fails loudly instead.
 *
 * The runtime's own message is dropped: Bun's carries the whole URL, and a
 * self-set RPC endpoint holds its key in the path.
 *
 * Its own class so a caller with somewhere else to try does not try there. A
 * chain rotating off an intercepted node would replace the one message that
 * says the network is rewriting traffic with whatever the next node reports.
 */
export class Intercepted extends TulaError {}

const redirected = (url: string): Intercepted =>
  new Intercepted(
    `${host(url)} redirected the request, and tula does not follow redirects.\n` +
      '  Nothing was sent on. This is normal for a captive portal or a proxy\n' +
      '  that intercepts TLS; on a plain network it is worth treating as suspect.',
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
      // `redirect` first, so a caller that needs to follow one says so and the
      // rest cannot acquire the behaviour by omission. Only `src/update` does.
      fetch(url, { redirect: 'error', ...init, signal: AbortSignal.timeout(timeoutMs) }),
      deadline,
    ])
  } catch (err) {
    // Named rather than re-thrown: an abort surfaces as `TimeoutError: The
    // operation was aborted`, which says nothing about which venue stopped
    // answering, or that waiting longer would not have helped.
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw tooSlow(url, timeoutMs)
    }
    if (isRedirect(err)) throw redirected(url)
    throw err
  } finally {
    clearTimeout(timer)
  }
}
