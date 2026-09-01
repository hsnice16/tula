import { Box, Text, type BoxProps } from 'ink'
import type { ReactNode } from 'react'
import { theme } from './theme.js'

interface Props {
  rows: number
  title: string
  /** The way out, top right, where the reference puts it. */
  hint: string
  children: ReactNode
}

/**
 * One row short of the viewport, and both bounds are load-bearing.
 *
 * Tall enough that the panel pushes the transcript off screen — a terminal
 * cannot draw over what `<Static>` already committed to scrollback, so filling
 * the view is the only takeover available, and without it a collapsed entry
 * sits directly above its own expansion.
 *
 * Short enough that Ink does not count the frame as fullscreen. At or above the
 * terminal height it answers the *next* frame with `clearTerminal +
 * fullStaticOutput`: the whole session reprinted and the user's scrollback
 * wiped, every time a panel closes.
 *
 * No width in cells, for the same reason the frame around it has none: Ink
 * repaints on the resize event and paints the tree it already holds, so a width
 * measured before the drag is laid into a terminal that has since narrowed —
 * every row wraps to two while Ink counts one, its erase runs short, and the
 * previous frame stays on screen. Stretching to the container is re-derived on
 * that same repaint. The height cannot be relative, so it stays a number.
 */
export function Modal({ rows, title, hint, children }: Props) {
  return (
    <Box height={rows - 1} paddingX={2} paddingY={1}>
      <Box
        flexGrow={1}
        flexDirection="column"
        backgroundColor={theme.surface}
        paddingX={2}
        paddingY={1}
      >
        <Box marginBottom={1}>
          <Box flexGrow={1}>
            <Text bold color={theme.accent} wrap="truncate">
              {title}
            </Text>
          </Box>
          <Text dimColor>{hint}</Text>
        </Box>
        {children}
      </Box>
    </Box>
  )
}

/** The selected row is a bar, not a caret: at a glance it is the only lit thing. */
export function Row({
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
