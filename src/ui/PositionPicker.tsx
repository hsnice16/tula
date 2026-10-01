import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { assetName, signedMoney, type PositionDetail } from '../core/detail.js'
import { accountCell, quantity } from '../core/format.js'
import type { Position } from '../core/position.js'
import { paletteGeometry } from './Palette.js'
import { windowStart } from './scroll.js'
import { renderTable, type Align } from './table.js'
import { InputLine } from './TextInput.js'
import { theme } from './theme.js'
import { cells, wrapLines } from './wrap.js'

/** One drawn row of the detail: a section's name, a label beside its figure, or a sentence. */
export type DetailLine =
  | { tone: 'section'; text: string }
  | { tone: 'figure'; label: string; value: string }
  | { tone: 'note'; text: string }
  | { tone: 'gap' }

/** The header and its rule, fixed above the rows while they scroll. */
export const PICKER_HEAD = 2

/**
 * The list as a table, drawn by `/positions`' renderer so the two read alike.
 * VENUE appears where the rows span more than one, and ACCOUNT, PNL and
 * PRODUCT where a row has one. Too wide for `width`, whole columns go rather
 * than the edge cutting one — a quantity cut to `7…` reads as 7. PNL goes
 * first, as the detail carries it; then the names, last the one that tells
 * two accounts' rows apart, since no two rows may read alike but for figures.
 */
export function pickerTable(
  positions: readonly Position[],
  width = Number.POSITIVE_INFINITY,
  /** The rows the columns are chosen from, so a filter leaving none keeps them. */
  basis: readonly Position[] = positions,
): { head: string[]; rows: string[] } {
  type Column = { id: string; head: string; align: Align; cell: (p: Position) => string }
  const venues = new Set(basis.map((p) => p.venue)).size > 1
  const accounts = basis.some((p) => p.account)
  const products = basis.some((p) => p.product)
  const pnl = basis.some((p) => p.figures?.unrealisedPnl !== undefined)
  const all: Column[] = [
    ...(venues ? [{ id: 'venue', head: 'VENUE', align: 'left' as const, cell: (p: Position) => p.venue }] : []),
    { id: 'kind', head: 'KIND', align: 'left', cell: (p) => p.kind },
    { id: 'asset', head: 'ASSET', align: 'left', cell: assetName },
    { id: 'quantity', head: 'QUANTITY', align: 'right', cell: (p) => quantity(p.quantity) },
    ...(pnl
      ? [
          {
            id: 'pnl',
            head: 'PNL',
            align: 'right' as const,
            cell: (p: Position) =>
              p.figures?.unrealisedPnl === undefined ? '—' : signedMoney(p.figures.unrealisedPnl, p.figures.currency),
          },
        ]
      : []),
    ...(accounts ? [{ id: 'account', head: 'ACCOUNT', align: 'left' as const, cell: (p: Position) => accountCell(p.account) }] : []),
    ...(products ? [{ id: 'product', head: 'PRODUCT', align: 'left' as const, cell: (p: Position) => p.product ?? '—' }] : []),
  ]
  const draw = (columns: Column[]) =>
    renderTable(
      columns.map((c) => c.head),
      positions.map((p) => columns.map((c) => c.cell(p))),
      columns.map((c) => c.align),
    ).split('\n')
  let columns = all
  let lines = draw(columns)
  // One cell of the row's leading space counts against the width too.
  const fits = (drawn: string[]) => drawn.every((line) => cells(line) + 1 <= width)
  for (const drop of ['pnl', 'product', 'venue', 'account']) {
    if (fits(lines)) break
    if (!columns.some((c) => c.id === drop)) continue
    columns = columns.filter((c) => c.id !== drop)
    lines = draw(columns)
  }
  return { head: lines.slice(0, PICKER_HEAD), rows: lines.slice(PICKER_HEAD) }
}

const pad = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - cells(text)))

/** Gap between a label and its figure: wide enough that the two never read as one phrase. */
const LABEL_GAP = 3

/** The detail as the dialog draws it, wrapped to the width it has. */
export function detailLines(detail: PositionDetail, width: number): DetailLine[] {
  const labels = Math.max(...detail.sections.flatMap((s) => s.rows.map((r) => cells(r.label))))
  // Two cells of indent under the section name, then the label, the gap and the figure.
  const room = Math.max(10, width - 2 - labels - LABEL_GAP)
  const lines: DetailLine[] = []
  for (const section of detail.sections) {
    if (lines.length > 0) lines.push({ tone: 'gap' })
    lines.push({ tone: 'section', text: section.title })
    for (const row of section.rows) {
      wrapLines(row.value, room).forEach((value, at) =>
        lines.push({ tone: 'figure', label: at === 0 ? pad(row.label, labels) : ' '.repeat(labels), value }),
      )
    }
  }
  if (detail.notes.length > 0) lines.push({ tone: 'gap' })
  for (const note of detail.notes) {
    for (const text of wrapLines(note, width)) lines.push({ tone: 'note', text })
  }
  return lines
}

interface Props {
  query: string
  cursor: number
  /** The table's heading and rule, and its rows, from `pickerTable`. */
  head: string[]
  rows: string[]
  selected: number
  offset: number
  /** Set once a row is opened: the list gives way to it in the same dialog. */
  detail: DetailLine[] | null
  /** The opened row, named as the tables name it. */
  title: string
  /** Esc from the detail closes rather than going back, where there was no list before it. */
  direct: boolean
  /** Why the list is empty, where it is. */
  empty: string
  columns: number
  screenRows: number
  /** The screen the dialog floats over, drawn again — see `Palette.tsx`. */
  behind: ReactNode
}

/**
 * The rows of the window a list or a detail scrolls in. The list's heading is
 * held above them, so it gives up those rows; the detail has none.
 */
export function pickerWindow(columns: number, screenRows: number, detail: readonly DetailLine[] | null) {
  const box = paletteGeometry(columns, screenRows, detail?.length)
  const head = detail ? 0 : PICKER_HEAD
  return { ...box, rowsTop: box.listTop + head, rowsLimit: Math.max(1, box.limit - head) }
}

/**
 * Every position, to pick one and read it in full. A modal rather than a
 * highlight in the `/positions` table: that table is <Static>, written once,
 * and `tasks/field-report/16-position-picker.md` says what that rules out.
 *
 * Presentational only: the app owns every key.
 */
export function PositionPicker(props: Props) {
  const { query, cursor, head, rows, selected, offset, detail, title, direct, empty, columns, screenRows, behind } = props
  const { top, left, width, listWidth, rowsLimit } = pickerWindow(columns, screenRows, detail)
  const count = detail ? detail.length : rows.length
  const items = Array.from({ length: count }, (_, at) => ({ kind: 'row' as const, at }))
  const start = windowStart(items, rowsLimit, offset)
  const shown = items.slice(start, start + rowsLimit)
  const below = count - start - shown.length

  const footer = detail
    ? `${below > 0 ? `${below} more below · ↓ scrolls · ` : ''}${direct ? 'esc closes' : 'esc back to the list'}`
    : rows.length === 0
      ? query
        ? 'nothing matches — backspace to widen it, or esc to close'
        : 'esc closes'
      : `${below > 0 ? `${below} more below · ` : ''}enter opens it · esc closes`

  const drawn = (at: number) => {
    if (!detail) {
      const picked = at === selected
      return (
        <Box key={at} {...(picked ? { backgroundColor: theme.accent } : {})}>
          <Text wrap="truncate" bold={picked} {...(picked ? { color: theme.onAccent } : {})}>
            {` ${rows[at] ?? ''}`}
          </Text>
        </Box>
      )
    }
    const line = detail[at]
    if (!line || line.tone === 'gap') return <Text key={at}> </Text>
    if (line.tone === 'section') {
      return (
        <Text key={at} bold color={theme.notice} wrap="truncate">
          {line.text}
        </Text>
      )
    }
    if (line.tone === 'note') {
      return (
        <Text key={at} dimColor wrap="truncate">
          {line.text}
        </Text>
      )
    }
    // The label dim and the figure bright, a wide gap between: read down the
    // right-hand column, the figures are the only thing lit.
    return (
      <Text key={at} wrap="truncate">
        <Text dimColor>{`  ${line.label}${' '.repeat(LABEL_GAP)}`}</Text>
        <Text bold>{line.value}</Text>
      </Text>
    )
  }

  return (
    // Exactly the viewport, for the reason `Palette.tsx` gives.
    <Box height={screenRows} flexDirection="column" overflow="hidden">
      <Box flexGrow={1} flexDirection="column">
        {behind}
      </Box>

      <Box
        position="absolute"
        top={top}
        left={left}
        width={width}
        flexDirection="column"
        backgroundColor={theme.surface}
        borderStyle="round"
        borderColor={theme.accentSoft}
        paddingX={2}
        paddingY={1}
      >
        <Box marginBottom={1}>
          <Box flexGrow={1}>
            <Text bold color={theme.accent} wrap="truncate">
              {detail ? title : 'positions'}
            </Text>
          </Box>
          <Text dimColor>esc</Text>
        </Box>

        <Box marginBottom={1}>
          {detail ? (
            <Text dimColor wrap="truncate">
              one position in full
            </Text>
          ) : (
            <>
              <Text dimColor>{query.length > 0 ? '' : 'filter  '}</Text>
              <Text color={theme.accent}>
                <InputLine value={query} cursor={cursor} />
              </Text>
            </>
          )}
        </Box>

        <Box flexDirection="column" width={listWidth}>
          {!detail &&
            head.map((line, at) => (
              <Text key={`head${at}`} dimColor wrap="truncate">
                {` ${line}`}
              </Text>
            ))}
          {shown.map(({ at }) => drawn(at))}
          {/* A space where there is nothing to say, so the dialog keeps its rows. */}
          {count === 0 && (
            <Text dimColor wrap="truncate">
              {empty || ' '}
            </Text>
          )}
          {/* The dialog keeps its height whatever the filter leaves. */}
          {Array.from({ length: Math.max(0, rowsLimit - shown.length - (count === 0 ? 1 : 0)) }, (_, i) => (
            <Text key={`pad${i}`}> </Text>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text dimColor wrap="truncate">
            {footer}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
