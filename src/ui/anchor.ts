/**
 * Where the frame ended up on the screen, which nothing on this side knows.
 * Ink draws the live frame wherever the transcript left the cursor: at the
 * bottom of the viewport once the session has filled it, and part-way down
 * before that. The pointer reports absolute rows, so hit-testing the `/` menu
 * needs the one number that ties the two together.
 *
 * The terminal is the only thing that has it, and this is how it is asked —
 * `CSI 6n`, answered on stdin as `CSI <row>;<col> R`. The dialog ctrl+s opens
 * needs none of this: it is drawn at a position it chose itself.
 *
 * A terminal that does not answer leaves the menu on the keyboard and the
 * wheel, which need no anchor.
 */
export function askCursor(stdout: NodeJS.WriteStream): void {
  stdout.write('\x1b[6n')
}

/** `CSI ? u`: which kitty keyboard flags are on. A terminal that knows the protocol answers it. */
export function askKeyboard(stdout: NodeJS.WriteStream): void {
  stdout.write('\x1b[?u')
}

/** A reply the terminal sent to a question tula asked it, rather than a key somebody pressed. */
export type TerminalReply = { kind: 'cursor'; row: number } | { kind: 'keyboard'; flags: number }

/**
 * The terminal's answers to the two questions tula asks it, whenever they
 * arrive. Ink splits an escape sequence out of the text around it and hands a
 * handler the sequence with its ESC taken off — or, where the ESC arrived alone
 * and was flushed as the Esc key, the rest as text — so both forms are matched,
 * and only whole: a reply is never a part of what somebody typed.
 *
 * Unrecognised, each reaches the line as the punctuation it looks like, and a
 * terminal answering the keyboard question late types `[?0u` into the input
 * before a key is pressed.
 */
export function terminalReply(chunk: string): TerminalReply | null {
  const cursor = /^\x1b?\[(\d+);\d+R$/.exec(chunk)
  if (cursor) {
    const row = Number(cursor[1]) - 1
    return Number.isFinite(row) && row >= 0 ? { kind: 'cursor', row } : null
  }
  const keyboard = /^\x1b?\[\?(\d+)u$/.exec(chunk)
  return keyboard ? { kind: 'keyboard', flags: Number(keyboard[1]) } : null
}
