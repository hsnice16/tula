import { Box, Text } from 'ink'
import { charAt, rowOf, visualRows } from './line.js'

/**
 * Rows the input shows before it scrolls. On a 24-row terminal, eight of them,
 * the two rules, the smallest menu of four, its count, the status line and one
 * hint row still leave seven rows of the answer the question is about.
 */
export const INPUT_ROWS = 8

interface Props {
  value: string
  cursor: number
  placeholder?: string
  dim?: boolean
  /**
   * The cells the text may use. Given, the text is drawn as rows that wrap here
   * and scrolls past `INPUT_ROWS`; left out, it is one run Ink wraps, for the
   * fields that hold a single line.
   */
  width?: number
  /** Drawn dim after the cursor, on its row, and cut rather than wrapped. */
  suggestion?: string
}

/**
 * Presentational only. All key handling lives in the app, because the slash
 * menu and the line editor compete for the same arrow keys and Enter, and two
 * independent input hooks cannot agree on who won.
 */
export function InputLine({ value, cursor, placeholder, dim, width, suggestion }: Props) {
  if (value.length === 0) {
    return (
      <Text wrap="truncate">
        {dim ? <Text> </Text> : <Text inverse> </Text>}
        <Text dimColor>{placeholder ? ` ${placeholder}` : ''}</Text>
        {suggestion ? <Text dimColor>{suggestion}</Text> : null}
      </Text>
    )
  }

  const at = Math.min(cursor, value.length)
  if (width === undefined) {
    const char = charAt(value, at)
    return (
      <Text>
        {value.slice(0, at)}
        {dim ? char || ' ' : <Text inverse>{char || ' '}</Text>}
        {value.slice(at + char.length)}
      </Text>
    )
  }

  const rows = visualRows(value, width)
  const here = rowOf(rows, at)
  // The window follows the cursor, and a row it gives up to say what is out of
  // view is counted inside the eight, so the box never grows past them.
  const first = Math.max(0, Math.min(here - Math.floor(INPUT_ROWS / 2), rows.length - INPUT_ROWS))
  const last = Math.min(rows.length, first + INPUT_ROWS)
  const above = first
  const below = rows.length - last

  return (
    <Box flexDirection="column">
      {rows.slice(first, last).map((row, offset) => {
        const index = first + offset
        // Each row is its own truncated `Text`: rows are wrapped here, and a
        // stale width during a resize then costs a row its last cells rather
        // than wrapping it into a row Ink never erases.
        if (index === first && above > 0 && index !== here) {
          return (
            <Text key={index} dimColor wrap="truncate">
              {`↑ ${above} more line${above === 1 ? '' : 's'}`}
            </Text>
          )
        }
        if (index === last - 1 && below > 0 && index !== here) {
          return (
            <Text key={index} dimColor wrap="truncate">
              {`↓ ${below} more line${below === 1 ? '' : 's'}`}
            </Text>
          )
        }
        const text = value.slice(row.start, row.end)
        if (index !== here) {
          return (
            <Text key={index} dimColor={dim === true} wrap="truncate">
              {text || ' '}
            </Text>
          )
        }
        const column = at - row.start
        const char = at < row.end ? charAt(value, at) : ''
        // At the end of the text the cursor sits on the suggestion's first
        // character, as fish and zsh-autosuggestions draw it, rather than on a
        // blank cell that splits the word being suggested.
        const onSuggestion = !char && suggestion ? charAt(suggestion, 0) : ''
        const under = char || onSuggestion || ' '
        return (
          <Text key={index} wrap="truncate-end">
            <Text dimColor={dim === true}>{text.slice(0, column)}</Text>
            {dim ? <Text>{under}</Text> : <Text inverse>{under}</Text>}
            <Text dimColor={dim === true}>{text.slice(column + char.length)}</Text>
            {suggestion ? <Text dimColor>{suggestion.slice(onSuggestion.length)}</Text> : null}
          </Text>
        )
      })}
    </Box>
  )
}
