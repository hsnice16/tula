import { Box, Text, type BoxProps } from 'ink'
import type { ReactNode } from 'react'
import type { PaletteEntry } from '../cli/registry.js'
import { BRAND_MARK, brandColor } from './brand.js'
import { windowStart } from './scroll.js'
import { theme } from './theme.js'

interface Props {
  query: string
  matches: PaletteEntry[]
  selected: number
  /** First display row on screen. The app owns it: the wheel moves it directly. */
  offset: number
  columns: number
  rows: number
  /**
   * The screen the dialog floats over, drawn again. Ink composites a frame into
   * a cell grid and the transcript is <Static> — written to the terminal once
   * and absent from that grid — so the only thing an overlay can be laid over
   * is a copy of what is underneath it.
   */
  behind: ReactNode
}

export type DisplayItem =
  | { kind: 'gap' }
  | { kind: 'heading'; text: string }
  | { kind: 'row'; entry: PaletteEntry; at: number }

/** Border and padding, header, search, the blanks around both, and the footer. */
const CHROME_ROWS = 10

/** About a third of a screen, which is as much list as is worth reading without narrowing it. */
const WINDOW_ROWS = 12

/** Fits `/shock <asset> <percent>`, the longest summary beside it and the mark gutter, untruncated. */
const DIALOG_COLUMNS = 90

/** The input box and the status line: rows the dialog centres above rather than sits on. */
export const FRAME_ROWS = 4

/**
 * Constant, not fitted to the matches: a dialog that resizes as you type walks
 * its own search line out from under the cursor.
 */
export function windowRows(rows: number): number {
  return Math.max(3, Math.min(rows - CHROME_ROWS - FRAME_ROWS, WINDOW_ROWS))
}

/**
 * The rows to draw, headings and blanks included. Scrolling counts in these
 * rather than in matches, so a wheel notch moves the list by exactly what the
 * eye sees move — and the app has to measure the same list the dialog draws,
 * which is why this is not inlined into the render.
 */
export function displayRows(matches: PaletteEntry[], query: string): DisplayItem[] {
  const items: DisplayItem[] = []
  matches.forEach((entry, at) => {
    if (query.trim() === '' && entry.group !== matches[at - 1]?.group) {
      // Sections are the only structure in a list this long, so they are worth
      // a row each. Not above the first one, which would be a gap under the search.
      if (items.length > 0) items.push({ kind: 'gap' })
      items.push({ kind: 'heading', text: entry.group })
    }
    items.push({ kind: 'row', entry, at })
  })
  return items
}

/** Rows above the list inside the dialog: border, padding, the header and the search line. */
const LIST_TOP = 6

export interface Geometry {
  /** Frame rows and columns, both 0-based, of the dialog's top-left corner. */
  top: number
  left: number
  width: number
  height: number
  /** First row of the list, and the columns it and the scrollbar occupy. */
  listTop: number
  listLeft: number
  listWidth: number
  barColumn: number
  limit: number
}

/**
 * Where the dialog lands, for the pointer to be tested against. The render
 * below is the other reader of this: a click has to hit the row the eye says it
 * is on, so both sides measure from the same numbers rather than each deriving
 * their own.
 */
export function paletteGeometry(columns: number, rows: number): Geometry {
  const limit = windowRows(rows)
  const width = Math.max(24, Math.min(DIALOG_COLUMNS, columns - 8))
  const height = limit + CHROME_ROWS
  const top = Math.max(0, Math.floor((rows - FRAME_ROWS - height) / 2))
  const left = Math.max(0, Math.floor((columns - width) / 2))
  // Two columns held back for the scrollbar and the gap before it, whether or
  // not there is a thumb to draw: a gutter that appears with the eleventh match
  // would shift every row on screen sideways.
  const listWidth = width - 8
  const listLeft = left + 3
  return {
    top,
    left,
    width,
    height,
    limit,
    listTop: top + LIST_TOP,
    listLeft,
    listWidth,
    barColumn: listLeft + listWidth + 1,
  }
}

/**
 * Search across the whole command surface at once. Grouped while browsing and
 * flat once you type, because ranking interleaves the sections and a heading
 * over one row is noise. The `/` menu stays the other way round — grouped and
 * alphabetical, the only order predictable before you have learned the list.
 *
 * Presentational only: the app owns every key.
 */
export function Palette({ query, matches, selected, offset, columns, rows, behind }: Props) {
  const label = (entry: PaletteEntry) => `/${entry.path} ${entry.args ?? ''}`.trimEnd()
  // Measured across every match, not the visible window: padding to whatever
  // happens to be on screen moves the summary column sideways as you scroll.
  const width = matches.length > 0 ? Math.max(...matches.map((e) => label(e).length)) : 0
  const { top, left, width: dialogColumns, listWidth: inner, limit } = paletteGeometry(columns, rows)

  const items = displayRows(matches, query)
  const start = windowStart(items, limit, offset)
  const shown = items.slice(start, start + limit)
  const chosen = matches[selected]
  // Rows past the bottom of the window, not rows off screen: counted the second
  // way it never reaches zero at the end of the list, so it reads as a list that
  // has more below and will not go there.
  const below = items.slice(start + limit).filter((i) => i.kind === 'row').length

  return (
    /*
     * Exactly the viewport, which is the one height that works. Shorter and the
     * copy behind is a second transcript scrolled in under the real one, with
     * nothing to put the real one back when the dialog closes. Taller and Ink
     * treats the frame as overflowing and clears on every keystroke.
     *
     * At exactly this height Ink calls the frame fullscreen, and the shrink back
     * on close is what makes it reprint <Static> — so the transcript returns
     * whole, at the cost of the scrollback above tula. The same cost ctrl+o owes.
     */
    <Box height={rows} flexDirection="column" overflow="hidden">
      <Box flexGrow={1} flexDirection="column">
        {behind}
      </Box>

      {/* Last, so it is written last: the grid keeps whichever write lands on a
          cell most recently, which is the whole of how an overlay works here. */}
      <Box
        position="absolute"
        top={top}
        left={left}
        width={dialogColumns}
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
              commands
            </Text>
          </Box>
          <Text dimColor>esc</Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>{query.length > 0 ? '' : 'search  '}</Text>
          <Text color={theme.accent}>{query}</Text>
          <Text inverse> </Text>
        </Box>

        <Box flexDirection="row">
          <Box flexDirection="column" flexGrow={1}>
            {shown.map((item, index) => {
              if (item.kind === 'gap') return <Text key={`g${start + index}`}> </Text>
              if (item.kind === 'heading') {
                return (
                  <Text key={`h${start + index}`} color={theme.notice}>
                    {item.text}
                  </Text>
                )
              }
              const style =
                item.at === selected ? { bold: true, color: theme.onAccent } : { dimColor: true }
              // The selected row is a gold bar, and a brand colour laid on it is
              // unreadable at best and a different brand at worst. Identity gives
              // way to legibility for the one row that has the cursor on it.
              const brand = brandColor(item.entry.path)
              const mark = brand && (item.at === selected ? theme.onAccent : brand)
              return (
                <Row key={item.entry.path} selected={item.at === selected} width={inner}>
                  <Text wrap="truncate">
                    <Text {...style}>{` ${label(item.entry).padEnd(width)}  `}</Text>
                    {mark ? <Text color={mark}>{BRAND_MARK}</Text> : <Text> </Text>}
                    <Text {...style}>{` ${item.entry.summary}`}</Text>
                  </Text>
                </Row>
              )
            })}

            {/* The dialog keeps its height whatever the filter leaves. */}
            {Array.from({ length: Math.max(0, limit - shown.length) }, (_, i) => (
              <Text key={`pad${i}`}> </Text>
            ))}
          </Box>

          <Box marginLeft={1}>
            <Scrollbar height={limit} total={items.length} at={start} />
          </Box>
        </Box>

        <Box marginTop={1}>
          {matches.length === 0 ? (
            <Text dimColor wrap="truncate">
              {'nothing matches — backspace to widen it, or esc to close'}
            </Text>
          ) : (
            <Text dimColor wrap="truncate">
              {below > 0 ? `${below} more below · ` : ''}
              {chosen?.runnable
                ? 'enter runs it · tab puts it on the line · esc closes'
                : `enter puts it on the line — ${chosen?.args ?? ''} still has to be typed · esc closes`}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  )
}

/**
 * Where you are in the list, which the wheel needs and the arrow keys never did:
 * scrolling with no cursor to follow leaves nothing else to say how far down the
 * list this is, or how much of it is on screen.
 */
function Scrollbar({ height, total, at }: { height: number; total: number; at: number }) {
  const thumb = total <= height ? height : Math.max(1, Math.round((height * height) / total))
  const travel = height - thumb
  const from = travel <= 0 ? 0 : Math.round((at / (total - height)) * travel)
  return (
    <Box flexDirection="column">
      {Array.from({ length: height }, (_, row) => {
        const lit = total > height && row >= from && row < from + thumb
        return (
          <Text key={row} color={lit ? theme.accent : theme.accentSoft} dimColor={!lit}>
            {lit ? '┃' : '│'}
          </Text>
        )
      })}
    </Box>
  )
}

/** The selected row is a bar, not a caret: at a glance it is the only lit thing. */
function Row({
  selected,
  children,
  ...rest
}: BoxProps & { selected: boolean; children: ReactNode }) {
  return (
    <Box {...rest} {...(selected ? { backgroundColor: theme.accent } : {})}>
      {children}
    </Box>
  )
}
