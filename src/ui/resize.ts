/**
 * Ink measures a frame by the newlines it wrote, and a terminal that has just
 * narrowed has already rewrapped that frame onto more rows — so its erase runs
 * short and the top of the old frame stays standing under the new one. One
 * ghost per narrowing, stacking through a drag. Ink's own `log.clear()` counts
 * the same way and falls short by the same rows.
 *
 * Erasing only the rows it misses does not work either: growing the frame
 * mid-reflow scrolls the screen, and rows that go over the top are past recall
 * — scroll-down pans in blanks rather than handing them back — so the repair
 * leaves that many rows empty, under the frame or as a gap above it. Drawing
 * the whole screen again is the only version that owes the terminal nothing.
 *
 * The scrollback goes with it because the transcript is <Static>: Ink writes it
 * once, so a redraw must re-emit it, and re-emitting appends. Clear the viewport
 * alone and the copy that had scrolled off the top survives to stack.
 *
 * Widening leaves no ghost, but the transcript carries Ink's line breaks rather
 * than the terminal's and the terminal cannot rejoin them, so it is owed a
 * redraw too — or a widened pane stays wrapped for the width it left.
 *
 * Attach before `render`: listeners run in the order they were added, and Ink's
 * has already repainted by the time a later one is called.
 */
export function guardResize(stdout: NodeJS.WriteStream): () => void {
  let last = stdout.columns
  const onResize = () => {
    const columns = stdout.columns
    // Height alone rewraps nothing, and Ink handles it without help.
    if (columns !== last) stdout.write('\x1b[2J\x1b[3J\x1b[H')
    last = columns
  }
  stdout.on('resize', onResize)
  return () => {
    stdout.off('resize', onResize)
  }
}
