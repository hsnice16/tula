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

/**
 * Signals whose default action is to end the process without unwinding
 * anything. React's cleanup does not run for these, and neither does `exit`.
 */
const FATAL: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']

/**
 * Returns the undo, which has to run: a terminal left in mouse mode stays there
 * after tula exits — moving the pointer writes escape codes at the user's shell
 * prompt and selecting text stops working, until they know to type
 * `printf '\x1b[?1006l\x1b[?1003l'`.
 *
 * A React cleanup alone was not enough to promise that. It covers unmounting
 * and nothing else: closing the window sends SIGHUP, a `kill` sends SIGTERM,
 * and both end the process where it stands. So the undo is also registered with
 * the process — on `exit`, which an uncaught exception reaches too, and on each
 * signal, which does not. The signal handlers re-raise after cleaning up rather
 * than exiting themselves, so the exit code is still the one the signal means.
 */
export function trackMouse(stdout: NodeJS.WriteStream): () => void {
  stdout.write(ON)

  let restored = false
  const off = (): void => {
    if (restored) return
    restored = true
    // The stream can already be gone on the way out of a crash, and throwing
    // here would replace the error the user needs to see with this one.
    try {
      stdout.write(OFF)
    } catch {
      // Nothing to do: the terminal is beyond reach either way.
    }
  }

  const onSignal = FATAL.map((signal) => {
    const handler = (): void => {
      off()
      process.removeListener(signal, handler)
      process.kill(process.pid, signal)
    }
    process.on(signal, handler)
    return [signal, handler] as const
  })

  // Node reaches `exit` from an uncaught throw; Bun does not, and Bun is what
  // the binary is compiled with. Each handler removes itself before re-raising,
  // so the crash still prints and still sets the exit code it would have —
  // restoring the terminal must not also swallow the error that got us here.
  const onCrash = (err: unknown): never => {
    off()
    process.removeListener('uncaughtException', onCrash)
    process.removeListener('unhandledRejection', onCrash)
    throw err
  }
  process.on('uncaughtException', onCrash)
  process.on('unhandledRejection', onCrash)
  process.on('exit', off)

  return () => {
    off()
    process.removeListener('exit', off)
    process.removeListener('uncaughtException', onCrash)
    process.removeListener('unhandledRejection', onCrash)
    for (const [signal, handler] of onSignal) process.removeListener(signal, handler)
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

/** The same two, unanchored, for reading a chunk that holds more than one. */
const ANY = /\x1b?\[(?:<\d+;\d+;\d+[Mm]|M[\s\S]{3})/g

/**
 * A report cut in half by the end of a chunk. Held for the next one rather than
 * typed — the ESC is required here, unlike above, so that somebody typing a
 * literal `[<` into the search box does not have it swallowed.
 */
const PARTIAL = /\x1b(?:\[(?:<[\d;]*|M[\s\S]{0,2})?)?$/

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

/**
 * Every report in one chunk, and whatever else it held.
 *
 * `mouseReport` matches a chunk that is exactly one report, which is the shape
 * a click arrives in. Mode 1003 reports every *movement*, and a hand crossing
 * the screen produces them faster than stdin is drained — so they arrive
 * several to a chunk, the anchored match failed, and the whole run was typed
 * into the line as the punctuation it looks like.
 *
 * `rest` is what was between and around them. A trailing partial report stays
 * in `partial` for the caller to prepend to the next chunk.
 */
export function mouseReports(chunk: string): {
  reports: MouseReport[]
  rest: string
  partial: string
} {
  const held = PARTIAL.exec(chunk)
  // Only when something else in the chunk says this is a mouse stream at all:
  // a lone ESC is how Escape is pressed, and holding it would eat the key.
  const partial = held && held[0] !== '\x1b' ? held[0] : ''
  const body = partial ? chunk.slice(0, -partial.length) : chunk

  const reports: MouseReport[] = []
  ANY.lastIndex = 0
  let rest = ''
  let from = 0
  for (let m = ANY.exec(body); m !== null; m = ANY.exec(body)) {
    rest += body.slice(from, m.index)
    const report = mouseReport(m[0])
    if (report) reports.push(report)
    from = m.index + m[0].length
  }
  rest += body.slice(from)
  return { reports, rest, partial }
}
