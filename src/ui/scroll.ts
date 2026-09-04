/**
 * A list too long for the rows it has, scrolled. Both the `/` menu and ctrl+k
 * draw headings between their rows, so what scrolls is the drawn rows rather
 * than the entries — a notch has to move the list by what the eye sees move.
 *
 * `at` is the entry's own index, which is what a selection counts in; a heading
 * or a blank has none.
 */
export interface Scrollable {
  kind: string
  at?: number
}

/** The offset actually drawn from, which a shorter list or a resize can pull back. */
export function windowStart(items: Scrollable[], limit: number, offset: number): number {
  return Math.max(0, Math.min(offset, items.length - limit))
}

/** The offset that brings `selected` on screen, moving the list as little as it can. */
export function offsetShowing(
  items: Scrollable[],
  limit: number,
  offset: number,
  selected: number,
): number {
  const at = items.findIndex((i) => i.kind === 'row' && i.at === selected)
  if (at === -1) return offset
  if (at < offset) return at
  if (at >= offset + limit) return at - limit + 1
  return offset
}

/**
 * The nearest selection that is actually on screen. The wheel moves the list
 * out from under the cursor, and enter has to run something the reader can see.
 */
export function selectionIn(
  items: Scrollable[],
  limit: number,
  offset: number,
  selected: number,
): number {
  const visible = items.slice(offset, offset + limit).filter((i) => i.kind === 'row')
  const first = visible[0]?.at
  const last = visible.at(-1)?.at
  if (first === undefined || last === undefined) return selected
  return Math.max(first, Math.min(last, selected))
}
