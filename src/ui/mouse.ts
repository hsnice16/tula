/**
 * Turning this on takes the mouse away from the terminal: no drag-selecting
 * text, no scrolling the terminal's own scrollback. That is why it is on only
 * while a list is up — the transcript is full of numbers people copy out of it,
 * and a list is a thing to point at rather than to select from.
 *
 * 1003 reports movement with no button held, which is the only way to know what
 * the pointer is over; 1006 asks for the answers back as digits rather than as
 * bytes offset by 32, which is the only form that survives past column 223.
 */
const ON = '\x1b[?1003h\x1b[?1006h'
const OFF = '\x1b[?1006l\x1b[?1003l'

/** Returns the undo, which has to run: a terminal left in mouse mode stays there after tula exits. */
export function trackMouse(stdout: NodeJS.WriteStream): () => void {
  stdout.write(ON)
  return () => {
    stdout.write(OFF)
  }
}

/** Terminal coordinates, 1-based from the top left of the screen. */
export type MouseReport =
  | { kind: 'wheel'; step: -1 | 1 }
  | { kind: 'press'; column: number; row: number }
  | { kind: 'release'; column: number; row: number }
  | { kind: 'drag'; column: number; row: number }
  | { kind: 'move'; column: number; row: number }

const SGR = /^\x1b?\[<(\d+);(\d+);(\d+)([Mm])$/
const X10 = /^\x1b?\[M([\s\S])([\s\S])([\s\S])$/

/**
 * What the mouse did, or null when the chunk is not a mouse report at all.
 * Anything unrecognised has to come back as *something*: a report that falls
 * through is punctuation, and gets typed into whatever has the cursor.
 *
 * The button byte is a bitfield — 64 is the wheel and its low bit the
 * direction, 32 is movement, and the bottom two bits name the button, 3 being
 * none. X10 is here because a terminal that ignored the 1006 request still
 * answers, in bytes offset by 32; rare, and the cost of missing it is a line of
 * punctuation in the search box.
 */
export function mouseReport(chunk: string): MouseReport | null {
  const sgr = SGR.exec(chunk)
  const x10 = sgr ? null : X10.exec(chunk)
  if (!sgr && !x10) return null

  const button = sgr ? Number(sgr[1]) : x10![1]!.charCodeAt(0) - 32
  const column = sgr ? Number(sgr[2]) : x10![2]!.charCodeAt(0) - 32
  const row = sgr ? Number(sgr[3]) : x10![3]!.charCodeAt(0) - 32
  if (!Number.isFinite(button) || !Number.isFinite(column) || !Number.isFinite(row)) return null

  if (button & 64) return { kind: 'wheel', step: button & 1 ? 1 : -1 }
  if (button & 32) {
    return { kind: (button & 3) === 3 ? 'move' : 'drag', column, row }
  }
  // Release carries no button number in either encoding, so the terminal saying
  // so is the only way to tell one from a press.
  if (sgr?.[4] === 'm' || (button & 3) === 3) return { kind: 'release', column, row }
  // Middle and right do nothing here, but must not be mistaken for a left click.
  if ((button & 3) !== 0) return { kind: 'release', column, row }
  return { kind: 'press', column, row }
}
