/**
 * Where the frame ended up on the screen, which nothing on this side knows.
 * Ink draws the live frame wherever the transcript left the cursor: at the
 * bottom of the viewport once the session has filled it, and part-way down
 * before that. The pointer reports absolute rows, so hit-testing the `/` menu
 * needs the one number that ties the two together.
 *
 * The terminal is the only thing that has it, and this is how it is asked —
 * `CSI 6n`, answered on stdin as `CSI <row>;<col> R`. The dialog ctrl+k opens
 * needs none of this: it is drawn at a position it chose itself.
 *
 * A terminal that does not answer leaves the menu on the keyboard and the
 * wheel, which need no anchor.
 */
export function askCursor(stdout: NodeJS.WriteStream): void {
  stdout.write('\x1b[6n')
}

const REPLY = /^\x1b?\[(\d+);\d+R$/

/** The row the cursor is on, counted from 0, or null when this is not the answer. */
export function cursorRow(chunk: string): number | null {
  const reply = REPLY.exec(chunk)
  if (!reply) return null
  const row = Number(reply[1]) - 1
  return Number.isFinite(row) && row >= 0 ? row : null
}
