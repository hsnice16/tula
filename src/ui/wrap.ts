/**
 * Hard-wrap to a column count, so a rendered row and a counted line are the
 * same unit. The transcript keeps the first N rows of an entry and counts the
 * rest; counting source lines instead, a wide table would claim twelve lines
 * while occupying twenty, and "18 more lines" would be short by eight.
 */
export function wrapLines(text: string, width: number): string[] {
  const columns = Math.max(1, Math.floor(width))
  return text.split('\n').flatMap((line) => wrapOne(line, columns))
}

function wrapOne(line: string, width: number): string[] {
  if (line.length <= width) return [line]
  const out: string[] = []
  let rest = line
  while (rest.length > width) {
    // Break at the last space that fits so words stay whole. A table row is
    // columns joined by spaces, so this lands on a column edge; a run with no
    // space in it has nowhere better than the margin.
    const space = rest.lastIndexOf(' ', width)
    const at = space > 0 ? space : width
    out.push(rest.slice(0, at))
    rest = space > 0 ? rest.slice(at + 1) : rest.slice(at)
  }
  if (rest.length > 0) out.push(rest)
  return out
}
