import { Box, Text } from 'ink'
import type { PaletteEntry } from '../cli/registry.js'
import { Modal, Row } from './Modal.js'
import { theme } from './theme.js'

interface Props {
  query: string
  matches: PaletteEntry[]
  selected: number
  columns: number
  rows: number
}

type DisplayItem =
  | { kind: 'heading'; text: string }
  | { kind: 'row'; entry: PaletteEntry; at: number }

/**
 * Search across the whole command surface at once. Grouped while browsing and
 * flat once you type, because ranking interleaves the sections and a heading
 * over one row is noise. The `/` menu stays the other way round — grouped and
 * alphabetical, the only order predictable before you have learned the list.
 *
 * Presentational only: the app owns every key.
 */
export function Palette({ query, matches, selected, columns, rows }: Props) {
  const label = (entry: PaletteEntry) => `/${entry.path} ${entry.args ?? ''}`.trimEnd()
  // Measured across every match, not the visible window: padding to whatever
  // happens to be on screen moves the summary column sideways as you scroll.
  const width = matches.length > 0 ? Math.max(...matches.map((e) => label(e).length)) : 0
  const inner = Math.max(20, columns - 8)
  const limit = Math.max(3, rows - 10)

  const items: DisplayItem[] = []
  matches.forEach((entry, at) => {
    if (query.trim() === '' && entry.group !== matches[at - 1]?.group) {
      items.push({ kind: 'heading', text: entry.group })
    }
    items.push({ kind: 'row', entry, at })
  })

  // The window follows the selection, so arrowing past the last visible row
  // scrolls rather than running the cursor off a list that never moves.
  const cursorAt = items.findIndex((i) => i.kind === 'row' && i.at === selected)
  const start = Math.max(0, Math.min(cursorAt - limit + 1, items.length - limit))
  const shown = items.slice(start, start + limit)
  const chosen = matches[selected]

  return (
    <Modal rows={rows} title="commands" hint="esc">
      <Box marginBottom={1}>
        <Text dimColor>{query.length > 0 ? '' : 'search  '}</Text>
        <Text color={theme.accent}>{query}</Text>
        <Text inverse> </Text>
      </Box>

      {shown.map((item, index) =>
        item.kind === 'heading' ? (
          <Text key={`h${start + index}`} color={theme.notice}>
            {item.text}
          </Text>
        ) : (
          <Row key={item.entry.path} selected={item.at === selected} width={inner}>
            <Text
              wrap="truncate"
              {...(item.at === selected ? { bold: true, color: theme.onAccent } : { dimColor: true })}
            >
              {` ${label(item.entry).padEnd(width)}  ${item.entry.summary}`}
            </Text>
          </Row>
        ),
      )}

      <Box flexGrow={1} />

      {matches.length === 0 ? (
        <Text dimColor wrap="truncate">
          {'nothing matches — backspace to widen it, or esc to close and ask in plain English'}
        </Text>
      ) : (
        <Text dimColor wrap="truncate">
          {items.length > shown.length ? `${items.length - shown.length} more below · ` : ''}
          {chosen?.runnable
            ? 'enter runs it · tab puts it on the line · esc closes'
            : `enter puts it on the line — ${chosen?.args ?? ''} still has to be typed · esc closes`}
        </Text>
      )}
    </Modal>
  )
}
