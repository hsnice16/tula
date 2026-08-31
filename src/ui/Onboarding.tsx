import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { hasAmbientCredentials } from '../agent/agent.js'
import { startSignIn } from '../agent/signin.js'
import { APP_VERSION } from '../version.js'
import { InputLine } from './TextInput.js'
import { theme } from './theme.js'

interface Props {
  /** Null means the user chose to continue with commands only. */
  onDone: (apiKey: string | null) => void
}

const OPTIONS = [
  { id: 'signin', label: 'Sign in with your Anthropic account', hint: 'opens a browser · tula stores nothing' },
  { id: 'paste', label: 'Paste an Anthropic API key', hint: 'console.anthropic.com/settings/keys' },
  { id: 'skip', label: 'Continue without one', hint: 'every command still works' },
] as const

/**
 * Asked once, before the first question, rather than surfaced as an error after
 * someone types something the tool then refuses to answer.
 */
export function Onboarding({ onDone }: Props) {
  const [choice, setChoice] = useState(0)
  const [entering, setEntering] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  // The browser flow finishes out of process, so the only way to know it landed
  // is to watch for the profile the CLI writes.
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => {
      if (hasAmbientCredentials()) {
        clearInterval(timer)
        setWaiting(false)
        onDone(null)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [waiting, onDone])

  useInput((input, keyEvent) => {
    if (waiting) {
      if (keyEvent.escape) {
        setWaiting(false)
        setError('Sign-in cancelled. tula did not receive anything.')
      }
      return
    }

    if (entering) {
      if (keyEvent.escape) {
        setEntering(false)
        setKey('')
        setError(null)
        return
      }
      if (keyEvent.return || /[\r\n]$/.test(input)) {
        const candidate = (key + input).replace(/[\r\n]+/g, '').trim()
        if (!candidate.startsWith('sk-ant-')) {
          setError('That does not look like an Anthropic key — they start with sk-ant-.')
          setKey('')
          return
        }
        onDone(candidate)
        return
      }
      if (keyEvent.backspace || keyEvent.delete) return setKey((k) => k.slice(0, -1))
      if (keyEvent.ctrl || keyEvent.meta || keyEvent.tab) return
      if (input) setKey((k) => k + input.replace(/[\r\n]+/g, ''))
      return
    }

    if (keyEvent.upArrow) return setChoice((c) => Math.max(0, c - 1))
    if (keyEvent.downArrow) return setChoice((c) => Math.min(OPTIONS.length - 1, c + 1))
    if (keyEvent.return) {
      const picked = OPTIONS[choice]?.id
      if (picked === 'paste') {
        setError(null)
        return setEntering(true)
      }
      if (picked === 'signin') {
        const started = startSignIn()
        if (!started.ok) return setError(started.reason)
        setError(null)
        return setWaiting(true)
      }
      return onDone(null)
    }
  })

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor={theme.accent} paddingX={2} paddingY={1} flexDirection="column">
        <Text bold color={theme.accent}>
          {`tula ${APP_VERSION}`}
        </Text>
        <Text dimColor>See your true exposure across every venue you trade on.</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>Ask questions in plain English, or drive it with commands.</Text>
        <Text dimColor>Plain English needs Anthropic credentials. Nothing else does.</Text>
        <Box marginTop={1}>
          <Text dimColor>
            {'Next, connect at least one venue — type / and pick it. tula shows nothing\nuntil it can read a real account, and it only ever asks for read-only keys.'}
          </Text>
        </Box>
      </Box>

      {waiting ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent}>Waiting for you to finish signing in…</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              {'A browser window should have opened. If it did not, run this in another\nterminal:  ant auth login'}
            </Text>
            <Text dimColor>
              {'\nThe token is stored by the Anthropic CLI, not by tula. Esc to cancel.'}
            </Text>
          </Box>
        </Box>
      ) : entering ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Paste the key, then press Enter. It is not echoed. Esc to go back.</Text>
          <Box
            marginTop={1}
            borderStyle="round"
            borderColor={theme.accent}
            borderLeft={false}
            borderRight={false}
            paddingX={1}
          >
            <Text color={theme.accent}>{'❯ '}</Text>
            <Text>{'•'.repeat(Math.min(key.length, 48))}</Text>
            <Text inverse> </Text>
          </Box>
          <Text dimColor>{`  stored at ~/.config/tula, mode 600, sent only to Anthropic`}</Text>
          {error && <Text color={theme.danger}>{`  ${error}`}</Text>}
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {OPTIONS.map((option, index) =>
            index === choice ? (
              <Text key={option.id} color={theme.accent} bold>
                {`❯ ${option.label}`}
                <Text dimColor>{`  ${option.hint}`}</Text>
              </Text>
            ) : (
              <Text key={option.id} dimColor>
                {`  ${option.label}  ${option.hint}`}
              </Text>
            ),
          )}
          {error && <Text color={theme.danger}>{`\n${error}`}</Text>}
          <Box marginTop={1}>
            <Text dimColor>↑↓ to choose · Enter to confirm</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
