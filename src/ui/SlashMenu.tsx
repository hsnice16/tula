import { Box, Text } from 'ink'
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
}

type DisplayItem = { kind: 'heading'; text: string } | { kind: 'row'; item: MenuItem; at: number }

export function SlashMenu({ items, selected, prefix, heading, limit }: Props) {
  const labelOf = (item: MenuItem) => `${prefix}${item.name} ${item.args ?? ''}`.trimEnd()
  const width = items.length > 0 ? Math.max(...items.map((i) => labelOf(i).length)) : 0

  const display: DisplayItem[] = []
  items.forEach((item, at) => {
    if (item.group !== undefined && item.group !== items[at - 1]?.group) {
      display.push({ kind: 'heading', text: item.group })
    }
    display.push({ kind: 'row', item, at })
  })

  const cursorAt = display.findIndex((d) => d.kind === 'row' && d.at === selected)
  const start = Math.max(0, Math.min(cursorAt - limit + 1, display.length - limit))
  const shown = display.slice(start, start + limit)
  const rest = display.length - shown.length

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {heading && <Text dimColor>{heading}</Text>}
      {shown.map((entry, index) =>
        entry.kind === 'heading' ? (
          <Text key={`h${start + index}`} dimColor wrap="truncate">
            {entry.text}
          </Text>
        ) : (
          // Only the selection is lit. Everything else is uniformly dim, so the
          // eye tracks one thing; grouping is carried by the labels, not weight.
          <Text
            key={entry.item.name}
            wrap="truncate"
            {...(entry.at === selected ? { color: theme.accent, bold: true } : { dimColor: true })}
          >
            {`${entry.at === selected ? '❯' : ' '} ${labelOf(entry.item).padEnd(width)}  ${entry.item.summary}`}
          </Text>
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
