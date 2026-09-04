import { expect, test } from 'bun:test'
import type { PaletteEntry } from '../cli/registry.js'
import { displayRows } from './Palette.js'
import { offsetShowing, selectionIn } from './scroll.js'

const entry = (path: string, group: string): PaletteEntry => ({
  path,
  summary: path,
  group,
  runnable: true,
})

const MATCHES = [
  entry('breaks', 'your book'),
  entry('exposure', 'your book'),
  entry('coingecko', 'price source'),
  entry('about', 'session'),
]

test('a heading and a gap take rows of their own, so scrolling counts them', () => {
  const rows = displayRows(MATCHES, '')
  expect(rows.map((r) => r.kind)).toEqual([
    'heading', 'row', 'row',
    'gap', 'heading', 'row',
    'gap', 'heading', 'row',
  ])
  // Ranking interleaves the sections, so there is nothing to head once you type.
  expect(displayRows(MATCHES, 'co').every((r) => r.kind === 'row')).toBe(true)
})

test('the window moves for the cursor only when it has to, and no further', () => {
  const rows = displayRows(MATCHES, '')
  expect(offsetShowing(rows, 4, 0, 1)).toBe(0)
  // Row 3 of MATCHES is the last item, eight rows down: the window ends there.
  expect(offsetShowing(rows, 4, 0, 3)).toBe(5)
  // Back to the top row, which is under a heading: as little as it can means
  // the heading itself stays off screen.
  expect(offsetShowing(rows, 4, 5, 0)).toBe(1)
})

/** Enter runs the selection, so the wheel must not leave it above or below the fold. */
test('scrolling past the cursor takes the cursor with it', () => {
  const rows = displayRows(MATCHES, '')
  expect(selectionIn(rows, 4, 0, 0)).toBe(0)
  expect(selectionIn(rows, 4, 5, 0)).toBe(2)
  expect(selectionIn(rows, 4, 0, 3)).toBe(1)
})
