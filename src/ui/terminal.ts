/**
 * Every mode tula sets on the terminal is one a shell cannot use: mouse
 * reporting writes escape codes at the prompt when the pointer moves, and the
 * kitty keyboard protocol turns every later keystroke into them. Either left on
 * reads as a broken terminal, until somebody knows the sequence that turns it
 * off.
 *
 * A React cleanup alone cannot promise the terminal back. It covers unmounting
 * and nothing else: closing the window sends SIGHUP, a `kill` sends SIGTERM,
 * and both end the process where it stands. So an undo is registered with the
 * process as well.
 */

/**
 * Signals whose default action is to end the process without unwinding
 * anything. React's cleanup does not run for these, and neither does `exit`.
 */
const FATAL: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']

/**
 * Every undo, in registration order, behind one handler per signal.
 *
 * One registry rather than a handler per caller, because re-raising ends the
 * process: a per-caller handler that cleans up and re-raises takes the process
 * down before the handlers registered after it run, so only the first mode
 * registered is ever handed back.
 */
const undos: Array<() => void> = []
let armed = false

/** Exported for `terminal.test.ts`: emitting a real signal re-raises, which ends the test run. */
export function runUndos(): void {
  // Last registered, first undone: a later mode may have been set on top of an
  // earlier one, and a caller that throws must not strand the ones behind it.
  for (const off of [...undos].reverse()) {
    try {
      off()
    } catch {
      // Handing the terminal back is best-effort; one mode's failure must not
      // keep the others set.
    }
  }
}

function arm(): void {
  if (armed) return
  armed = true
  for (const signal of FATAL) {
    const handler = (): void => {
      runUndos()
      process.removeListener(signal, handler)
      process.kill(process.pid, signal)
    }
    process.on(signal, handler)
  }

  // Node reaches `exit` from an uncaught throw; Bun does not, and Bun is what
  // the binary is compiled with. The handler removes itself before re-throwing,
  // so the crash still prints and still sets the exit code it would have —
  // restoring the terminal must not also swallow the error that got us here.
  const onCrash = (err: unknown): never => {
    runUndos()
    process.removeListener('uncaughtException', onCrash)
    process.removeListener('unhandledRejection', onCrash)
    throw err
  }
  process.on('uncaughtException', onCrash)
  process.on('unhandledRejection', onCrash)
  process.on('exit', runUndos)
}

/**
 * Runs `off` however the process ends — on `exit`, on each fatal signal, and on
 * an uncaught throw — and returns what unregisters it. The signal handlers
 * re-raise after cleaning up rather than exiting themselves, so the exit code is
 * still the one the signal means.
 */
export function whenLeaving(off: () => void): () => void {
  arm()
  undos.push(off)
  let released = false
  return () => {
    if (released) return
    released = true
    const at = undos.lastIndexOf(off)
    if (at !== -1) undos.splice(at, 1)
  }
}

/** `CSI > flags u` pushes an entry onto the terminal's keyboard-mode stack; `CSI < u` pops one. */
const PUSH = /\x1b\[>\d*u/g
const POP = /\x1b\[<\d*u/g
const POP_ONE = '\x1b[<u'
const PASTE_ON = '\x1b[?2004h'
const PASTE_OFF = '\x1b[?2004l'

/**
 * Hands back the two input modes set on tula's behalf: the kitty keyboard
 * protocol, and bracketed paste.
 *
 * The app pushes the protocol when the terminal answers its query, and nothing
 * else pops it; Ink turns bracketed paste off only on a clean unmount. So the
 * writes are watched rather than a flag assumed: an unconditional pop would pop
 * an entry the shell pushed before tula started, and what is taken back is
 * exactly what was set and not yet undone.
 */
export function holdInputModes(stdout: NodeJS.WriteStream): () => void {
  const original = stdout.write
  let pushed = 0
  let pasting = false
  stdout.write = function (this: NodeJS.WriteStream, chunk: unknown, ...rest: unknown[]) {
    const text = typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString() : ''
    if (text.includes('\x1b[')) {
      pushed += (text.match(PUSH) ?? []).length
      pushed = Math.max(0, pushed - (text.match(POP) ?? []).length)
      const on = text.lastIndexOf(PASTE_ON)
      const off = text.lastIndexOf(PASTE_OFF)
      if (on !== off) pasting = on > off
    }
    return (original as (...args: unknown[]) => boolean).call(this, chunk, ...rest)
  } as NodeJS.WriteStream['write']

  let released = false
  const off = (): void => {
    if (released) return
    released = true
    stdout.write = original
    // The stream can already be gone on the way out of a crash, and throwing
    // here would replace the error the user needs to see with this one.
    try {
      for (; pushed > 0; pushed--) original.call(stdout, POP_ONE)
      if (pasting) original.call(stdout, PASTE_OFF)
    } catch {
      // Nothing to do: the terminal is beyond reach either way.
    }
  }
  const unregister = whenLeaving(off)
  return () => {
    off()
    unregister()
  }
}
