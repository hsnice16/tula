export type Align = 'left' | 'right'

export function renderTable(headers: string[], rows: string[][], aligns: Align[] = []): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  )
  const pad = (cell: string, i: number): string => {
    const width = widths[i] ?? 0
    return aligns[i] === 'right' ? cell.padStart(width) : cell.padEnd(width)
  }
  const line = (cells: string[]): string => cells.map(pad).join('  ').trimEnd()

  return [
    line(headers),
    widths.map((w) => '─'.repeat(w)).join('  '),
    ...rows.map(line),
  ].join('\n')
}
