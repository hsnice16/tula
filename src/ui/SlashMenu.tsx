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
}

export function SlashMenu({ items, selected, prefix, heading }: Props) {
  if (items.length === 0) return null
  const labelOf = (item: MenuItem) => `${prefix}${item.name} ${item.args ?? ''}`.trimEnd()
  const width = Math.max(...items.map((i) => labelOf(i).length))

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {heading && <Text dimColor>{heading}</Text>}
      {items.map((item, index) => {
        const label = labelOf(item).padEnd(width)
        // Only the selection is lit. Everything else is uniformly dim, so the
        // eye tracks one thing; grouping is carried by the labels, not by weight.
        const groupChanged = item.group !== undefined && item.group !== items[index - 1]?.group
        return (
          <Box key={item.name} flexDirection="column">
            {groupChanged && (
              <Text dimColor>{`${index === 0 ? '' : '\n'}${item.group}`}</Text>
            )}
            <Box>
              {index === selected ? (
                <Text color={theme.accent} bold>{`❯ ${label}`}</Text>
              ) : (
                <Text dimColor>{`  ${label}`}</Text>
              )}
              <Text dimColor>{`  ${item.summary}`}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
