export interface Typed {
  /** What to insert at the cursor. */
  text: string
  /** The chunk ended in a newline, so the line is being submitted. */
  submits: boolean
}

/**
 * A paste arrives as one chunk, so `key.return` is false even when it ends in a
 * newline — that trailing newline is the submit and must not land in the line.
 * Interior newlines become spaces so a multi-line paste stays one editable line.
 *
 * Order matters: strip the trailing newline first, then translate the rest. An
 * earlier version ran `.trimEnd()` after the translation, which also swallowed a
 * plain typed space — making `/shock ETH -20` impossible to type at all.
 */
export function typed(chunk: string): Typed {
  const submits = /[\r\n]$/.test(chunk)
  const text = chunk.replace(/[\r\n]+$/, '').replace(/[\r\n]+/g, ' ')
  return { text, submits }
}
