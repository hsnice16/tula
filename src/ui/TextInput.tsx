import { Text } from 'ink'

interface Props {
  value: string
  cursor: number
  placeholder?: string
  dim?: boolean
}

/**
 * Presentational only. All key handling lives in the app, because the slash
 * menu and the line editor compete for the same arrow keys and Enter, and two
 * independent input hooks cannot agree on who won.
 */
export function InputLine({ value, cursor, placeholder, dim }: Props) {
  if (value.length === 0) {
    return (
      <Text>
        {dim ? <Text> </Text> : <Text inverse> </Text>}
        <Text dimColor>{placeholder ? ` ${placeholder}` : ''}</Text>
      </Text>
    )
  }

  const at = Math.min(cursor, value.length)
  const before = value.slice(0, at)
  const under = value.slice(at, at + 1) || ' '
  const after = value.slice(at + 1)

  return (
    <Text>
      {before}
      {dim ? under : <Text inverse>{under}</Text>}
      {after}
    </Text>
  )
}
