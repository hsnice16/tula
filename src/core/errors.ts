import { REPO_URL } from '../version.js'
import { visible } from './untrusted.js'

/**
 * A condition the user can act on: a bad key, a loose file mode, a venue that
 * refused us. These print as a message. Anything else is a bug in tula and
 * keeps its stack trace, because hiding those makes them unfindable.
 */
export class TulaError extends Error {}

/** Long enough to name the problem, too short to carry an argument. */
const MAX_REMOTE = 200

/**
 * Text somebody else wrote, on its way into a message tula prints.
 *
 * Bounded here, where it enters, rather than where it is rendered: the screen
 * that refuses an over-scoped key draws the error above the refusal, and Ink
 * writes text verbatim, so an escape sequence in a venue's error could repaint
 * the refusal into something that reads like success. Capping at the render
 * site instead would flatten tula's own messages too, and take the remedy line
 * off the end of them.
 */
export function remote(text: string): string {
  const clean = visible(text, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > MAX_REMOTE ? `${clean.slice(0, MAX_REMOTE - 1)}…` : clean
}

/**
 * What a failure reads as on screen, and the one place that decides.
 *
 * A `TulaError` is a condition the user can act on and says so itself. Anything
 * else is a bug in tula, and `String(err)` turned it into a bare line —
 * `TypeError: x is not a function` — with nothing to do about it and nowhere to
 * send it. The stack is kept for exactly that case; the least the screen can do
 * is say whose fault it is and where it goes.
 *
 * Here rather than in the shell because the connect screen renders failures too,
 * and it had its own thinner copy: an `ENOSPC` out of `secrets.put` reached the
 * screen that had just taken a key as one bare line, on the surface where a user
 * least knows what to do next.
 */
export function failureText(err: unknown): string {
  if (err instanceof TulaError) return err.message
  // A thrown non-Error carries no stack and no promise that the text is tula's
  // own, so it is bounded on the way to the screen. An `Error`'s message is
  // not: flattening that would take the remedy line off tula's own failures.
  const message = err instanceof Error ? err.message : remote(String(err))
  return `${message}\n  This is a bug in tula, not something you did.\n  Please report it: ${REPO_URL}/issues`
}
