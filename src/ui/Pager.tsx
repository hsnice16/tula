import { Box, Text } from 'ink'
import { Modal } from './Modal.js'

interface Props {
  /** The line that produced this output, so the pane says what you are reading. */
  title: string
  /** Already wrapped to the pane width: one entry here is one row on screen. */
  lines: string[]
  offset: number
  height: number
  /** Older truncated entries ctrl+o can still step back to. */
  older: number
  rows: number
}

export function Pager({ title, lines, offset, height, older, rows }: Props) {
  const shown = lines.slice(offset, offset + height)
  const last = Math.min(offset + height, lines.length)
  const keys = [
    lines.length > height ? '↑↓ · pgup/pgdn' : null,
    older > 0 ? `ctrl+o for the ${older} before it` : null,
  ].filter((k) => k !== null)

  return (
    <Modal rows={rows} title={`${title} · ${lines.length} lines`} hint="esc">
      {shown.map((line, index) => (
        // Pre-wrapped to the pane width, so truncate only catches what the wrap
        // could not know about; one wide character would otherwise reflow a row
        // onto two, and Ink's erase counts one — leaving the last frame behind.
        <Text key={offset + index} wrap="truncate">
          {line.length > 0 ? line : ' '}
        </Text>
      ))}

      <Box flexGrow={1} />

      {/* The way out is already named top right, so the footer counts instead. */}
      <Text dimColor wrap="truncate">
        {`${offset + 1}–${last} of ${lines.length}`}
        {keys.length > 0 ? ` · ${keys.join(' · ')}` : ''}
      </Text>
    </Modal>
  )
}
