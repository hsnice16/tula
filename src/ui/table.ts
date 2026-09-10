import { cells } from './wrap.js'

export type Align = 'left' | 'right'

export function renderTable(headers: string[], rows: string[][], aligns: Align[] = []): string {
  // Cells, not code units. An asset symbol is spelled by the venue, and one
  // CJK character measures one and is drawn two: padded by length, the column
  // it sits in is short by its own width and every column right of it moves.
  const widths = headers.map((h, i) =>
    Math.max(cells(h), ...rows.map((r) => cells(r[i] ?? ''))),
  )
  const pad = (cell: string, i: number): string => {
    const gap = ' '.repeat(Math.max(0, (widths[i] ?? 0) - cells(cell)))
    return aligns[i] === 'right' ? gap + cell : cell + gap
  }
  const line = (row: string[]): string => row.map(pad).join('  ').trimEnd()

  return [
    line(headers),
    widths.map((w) => '─'.repeat(w)).join('  '),
    ...rows.map(line),
  ].join('\n')
}
