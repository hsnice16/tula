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
