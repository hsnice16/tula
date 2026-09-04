import { Box, Text } from 'ink'
import { BRAND_MARK, brandColor } from './brand.js'
import { windowStart } from './scroll.js'
import { theme } from './theme.js'

export interface MenuItem {
  name: string
  args?: string
  summary: string
  /** Rows are grouped by this; the label prints once, above the first of its kind. */
  group?: string
}

interface Props {
  items: MenuItem[]
  selected: number
  /** What precedes each name, e.g. `/` at top level or `/kraken ` inside a venue. */
  prefix: string
  heading?: string
  /** Rows the block always occupies, filtered or not. */
  limit: number
  /** First drawn row on screen. The app owns it: the wheel moves it directly. */
  offset: number
}

export type DisplayItem =
  | { kind: 'heading'; text: string }
  | { kind: 'row'; item: MenuItem; at: number }

/**
 * The rows to draw, headings included. The app measures the same list to work
 * out what the pointer is over, so this cannot be inlined into the render.
 */
export function menuDisplay(items: MenuItem[]): DisplayItem[] {
  const display: DisplayItem[] = []
  items.forEach((item, at) => {
    if (item.group !== undefined && item.group !== items[at - 1]?.group) {
      display.push({ kind: 'heading', text: item.group })
    }
    display.push({ kind: 'row', item, at })
  })
  return display
}

export function SlashMenu({ items, selected, prefix, heading, limit, offset }: Props) {
  const labelOf = (item: MenuItem) => `${prefix}${item.name} ${item.args ?? ''}`.trimEnd()
  const width = items.length > 0 ? Math.max(...items.map((i) => labelOf(i).length)) : 0
  // Inside a venue the rows are `connect`, `positions`… and only the heading
  // names the third party, so that is where its mark goes.
  const headingMark = brandColor(prefix.replace(/^\//, ''))

  const display = menuDisplay(items)
  const start = windowStart(display, limit, offset)
  const shown = display.slice(start, start + limit)
  const rest = display.length - shown.length

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {heading && (
        <Text wrap="truncate">
          {headingMark && <Text color={headingMark}>{`${BRAND_MARK} `}</Text>}
          <Text dimColor>{heading}</Text>
        </Text>
      )}
      {shown.map((entry, index) =>
        entry.kind === 'heading' ? (
          <Text key={`h${start + index}`} dimColor wrap="truncate">
            {entry.text}
          </Text>
        ) : (
          // Only the selection is lit, and the marks. Everything else is
          // uniformly dim, so the eye tracks one thing; grouping is carried by
          // the labels, not weight. A mark is the exception because it is
          // identity, not emphasis.
          <Row
            key={entry.item.name}
            selected={entry.at === selected}
            mark={brandColor(entry.item.name)}
            label={labelOf(entry.item).padEnd(width)}
            summary={entry.item.summary}
          />
        ),
      )}
      {/* The block keeps its height whatever the filter leaves, so the line you
          are typing on never moves under the cursor. */}
      {Array.from({ length: Math.max(0, limit - shown.length) }, (_, i) => (
        <Text key={`pad${i}`}> </Text>
      ))}
      <Text dimColor wrap="truncate">
        {rest > 0 ? `  ${rest} more — keep typing to narrow it` : ' '}
      </Text>
    </Box>
  )
}

/**
 * One row, one `<Text>`: `wrap="truncate"` measures what it is given, so a row
 * split across sibling boxes is a row the last column is no longer counted at.
 * The dim goes on the segments rather than on the wrapper, because Ink applies a
 * parent's `dimColor` to its children and a dimmed brand colour is not that brand.
 *
 * The gutter is at the head of the summary, not of the row: the names are the
 * column being read down, and a mark in front of them indents the ones that
 * have it away from the ones that do not.
 */
function Row({
  selected,
  mark,
  label,
  summary,
}: { selected: boolean; mark: string | undefined; label: string; summary: string }) {
  const style = selected ? { color: theme.accent, bold: true } : { dimColor: true }
  return (
    <Text wrap="truncate">
      <Text {...style}>{`${selected ? '❯' : ' '} ${label}  `}</Text>
      {mark ? <Text color={mark}>{BRAND_MARK}</Text> : <Text> </Text>}
      <Text {...style}>{` ${summary}`}</Text>
    </Text>
  )
}
