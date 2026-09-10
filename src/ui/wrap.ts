/**
 * A terminal is a grid of cells, and a string's length is not how many of them
 * it takes: one CJK ideograph or emoji is drawn two cells wide, a combining
 * accent is drawn on the letter before it and takes none, and an astral code
 * point costs two code units. Every column here is measured in cells for that
 * reason — an asset symbol is written by the venue, and a table padded by
 * length is a table whose columns come apart on the one row it got wrong.
 */

/**
 * East Asian Wide and Fullwidth, plus the emoji blocks, as ranges rather than a
 * `\p{East_Asian_Width=W}` escape — that property is not one JavaScript regex
 * exposes. Bounds only: what falls between them is drawn one cell wide.
 */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x17000, 0x18d08],
  [0x1b000, 0x1b16f],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f19a],
  [0x1f200, 0x1f320],
  [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d],
  [0x1f54b, 0x1f54e],
  [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2],
  [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
]

/** Drawn on the character before them, so they claim no cell of their own. */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]/u

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })

const isWide = (code: number): boolean =>
  WIDE.some(([from, to]) => code >= from && code <= to)

/** How many columns of the terminal this text will occupy. */
export function cells(text: string): number {
  // The whole product is ASCII apart from what a venue wrote, so the common
  // case pays a scan rather than a segmentation.
  let plain = true
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code < 0x20 || code > 0x7e) {
      plain = false
      break
    }
  }
  if (plain) return text.length

  let total = 0
  for (const { segment } of graphemes.segment(text)) {
    // The cluster's own base decides: an emoji joined to a skin tone and a
    // letter carrying two accents are each one glyph in one place.
    if (ZERO_WIDTH.test(segment)) continue
    const base = segment.codePointAt(0)
    total += base !== undefined && isWide(base) ? 2 : 1
  }
  return total
}

/** The longest prefix of whole clusters that fits, and where it ends. */
function takeCells(text: string, width: number): number {
  let used = 0
  let at = 0
  for (const { segment } of graphemes.segment(text)) {
    const next = used + cells(segment)
    if (next > width) break
    used = next
    at += segment.length
  }
  return at
}

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
  if (cells(line) <= width) return [line]
  const out: string[] = []
  let rest = line
  while (cells(rest) > width) {
    // Break at the last space that fits so words stay whole. A table row is
    // columns joined by spaces, so this lands on a column edge; a run with no
    // space in it has nowhere better than the margin.
    const margin = takeCells(rest, width)
    const space = rest.lastIndexOf(' ', margin)
    // A single glyph wider than the column has to go somewhere, and taking
    // nothing here is a loop that never ends.
    const at = space > 0 ? space : Math.max(margin, [...graphemes.segment(rest)][0]?.segment.length ?? 1)
    out.push(rest.slice(0, at))
    rest = space > 0 ? rest.slice(at + 1) : rest.slice(at)
  }
  if (rest.length > 0) out.push(rest)
  return out
}
