import { clip, cells } from './wrap.js'

export type Align = 'left' | 'right'

/**
 * The width a table has to fit, and which columns may be cut to fit it. Only
 * words are cut: a figure or a time cut short is a different figure, so a table
 * whose figures alone are wider than the screen still wraps.
 */
export interface Fit {
  width: number
  elastic: readonly boolean[]
}

const GAP = 2

/** Below this a cut word stops saying anything: `poste…` is not a reason. */
const LEGIBLE = 12

/**
 * The narrowest a column can go and still tell its values apart, and never
 * under its heading. Two products cut to the same `Total S…` would make two
 * rows read alike, which is worse than the row wrapping.
 */
function floor(values: readonly string[], head: string, widest: number): number {
  const distinct = new Set(values).size
  for (let width = Math.max(cells(head), LEGIBLE); width < widest; width++) {
    if (new Set(values.map((v) => clip(v, width))).size === distinct) return width
  }
  return widest
}

/** Columns cut widest first, a cell at a time, until the table fits or nothing more can go. */
function fitted(headers: string[], rows: string[][], natural: number[], fit: Fit): number[] {
  const widths = [...natural]
  let over = widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1) - fit.width
  if (over <= 0) return widths
  const floors = natural.map((w, i) =>
    fit.elastic[i] ? floor(rows.map((r) => r[i] ?? ''), headers[i] ?? '', w) : w,
  )
  while (over > 0) {
    let widest = -1
    for (let i = 0; i < widths.length; i++) {
      if ((widths[i] ?? 0) > (floors[i] ?? 0) && (widest < 0 || (widths[i] ?? 0) > (widths[widest] ?? 0))) widest = i
    }
    if (widest < 0) break
    widths[widest] = (widths[widest] ?? 0) - 1
    over--
  }
  return widths
}

export function renderTable(headers: string[], rows: string[][], aligns: Align[] = [], fit?: Fit): string {
  // Cells, not code units. An asset symbol is spelled by the venue, and one
  // CJK character measures one and is drawn two: padded by length, the column
  // it sits in is short by its own width and every column right of it moves.
  const natural = headers.map((h, i) =>
    Math.max(cells(h), ...rows.map((r) => cells(r[i] ?? ''))),
  )
  const widths = fit ? fitted(headers, rows, natural, fit) : natural
  const pad = (cell: string, i: number): string => {
    const shown = clip(cell, widths[i] ?? 0)
    const gap = ' '.repeat(Math.max(0, (widths[i] ?? 0) - cells(shown)))
    return aligns[i] === 'right' ? gap + shown : shown + gap
  }
  const line = (row: string[]): string => row.map(pad).join(' '.repeat(GAP)).trimEnd()

  return [
    line(headers),
    widths.map((w) => '─'.repeat(w)).join(' '.repeat(GAP)),
    ...rows.map(line),
  ].join('\n')
}
