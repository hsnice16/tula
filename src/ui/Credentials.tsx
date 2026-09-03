import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { ambientFingerprint } from '../agent/agent.js'
import { startSignIn } from '../agent/signin.js'
import { credentialSummary, type CredentialSource } from '../cli/commands.js'
import * as secrets from '../secrets/store.js'
import { theme } from './theme.js'

/**
 * `first-run` is someone who has nothing and has not seen the tool yet;
 * `manage` is /login, reached by someone mid-session who wants to know what
 * they are signed in with and change it. Showing the first-run screen for both
 * was the bug: it re-announced the product, told a user with venues connected
 * to go connect one, and never said what the current credential was.
 */
export type CredentialsMode = 'first-run' | 'manage'

export type CredentialsResult =
  | { kind: 'key'; apiKey: string }
  | { kind: 'signed-in' }
  | { kind: 'signed-out' }
  | { kind: 'cancelled' }

interface Props {
  mode: CredentialsMode
  /** What the agent is using now. Decides what there is to change. */
  source: CredentialSource
  onDone: (result: CredentialsResult) => void
}

interface Option {
  id: 'signin' | 'paste' | 'signout' | 'leave'
  label: string
  hint: string
}

function options(mode: CredentialsMode, source: CredentialSource): Option[] {
  const signedIn = source !== 'none'
  const list: Option[] = [
    {
      id: 'signin',
      label: signedIn ? 'Sign in as someone else' : 'Sign in with your Anthropic account',
      hint: 'opens a browser · tula saves nothing',
    },
    {
      id: 'paste',
      label: signedIn ? 'Use an API key instead' : 'Paste an API key',
      hint: 'console.anthropic.com/settings/keys',
    },
  ]
  // Only a key tula wrote is a key tula can take back. Offering to sign out of
  // an environment variable or the Anthropic CLI's own profile would be a
  // button that cannot do what it says.
  if (source === 'stored') {
    list.push({ id: 'signout', label: 'Sign out', hint: 'tula forgets the key it saved' })
  }
  list.push(
    mode === 'first-run'
      ? { id: 'leave', label: 'Continue without one', hint: 'every command still works' }
      : { id: 'leave', label: 'Keep it as it is', hint: 'Esc' },
  )
  return list
}

/** What tula cannot change from in here, and where the user can. */
function immovable(source: CredentialSource): string | null {
  if (source === 'env') {
    return 'Your shell wins over anything saved here. A key you paste below is used\nonly once that variable is unset.'
  }
  if (source === 'ambient') {
    return 'The Anthropic CLI holds the token, not tula. To sign out, run:\n  ant auth logout'
  }
  return null
}

/**
 * Asked once before the first question, rather than surfaced as an error after
 * someone types something the tool then refuses to answer — and reachable again
 * through /login, which is the only way to see what is in use.
 */
export function Credentials({ mode, source, onDone }: Props) {
  const choices = options(mode, source)
  const [choice, setChoice] = useState(0)
  const [entering, setEntering] = useState(false)
  const [waiting, setWaiting] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  // The browser flow finishes out of process, so the only way to know it landed
  // is to watch the profile directory the Anthropic CLI writes. Compared against
  // the fingerprint taken when the wait started: someone signing in again
  // already has a profile, and existence alone would report success instantly.
  useEffect(() => {
    if (waiting === null) return
    const timer = setInterval(() => {
      if (ambientFingerprint() !== waiting) {
        clearInterval(timer)
        setWaiting(null)
        onDone({ kind: 'signed-in' })
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [waiting, onDone])

  useInput((input, keyEvent) => {
    if (waiting !== null) {
      if (keyEvent.escape) {
        setWaiting(null)
        setError('Sign-in cancelled. Nothing reached tula.')
      }
      // Detection is best-effort; the user watching the browser knows before
      // tula does, and a screen that cannot be left is worse than a wrong guess.
      if (keyEvent.return) {
        setWaiting(null)
        onDone({ kind: 'signed-in' })
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
        onDone({ kind: 'key', apiKey: candidate })
        return
      }
      if (keyEvent.backspace || keyEvent.delete) return setKey((k) => k.slice(0, -1))
      if (keyEvent.ctrl || keyEvent.meta || keyEvent.tab) return
      if (input) setKey((k) => k + input.replace(/[\r\n]+/g, ''))
      return
    }

    if (keyEvent.escape && mode === 'manage') return onDone({ kind: 'cancelled' })
    if (keyEvent.upArrow) return setChoice((c) => Math.max(0, c - 1))
    if (keyEvent.downArrow) return setChoice((c) => Math.min(choices.length - 1, c + 1))
    if (keyEvent.return) {
      const picked = choices[choice]?.id
      if (picked === 'paste') {
        setError(null)
        return setEntering(true)
      }
      if (picked === 'signin') {
        const started = startSignIn()
        if (!started.ok) return setError(started.reason)
        setError(null)
        return setWaiting(ambientFingerprint())
      }
      if (picked === 'signout') return onDone({ kind: 'signed-out' })
      return onDone({ kind: 'cancelled' })
    }
  })

  const cannotChange = immovable(source)

  return (
    <Box flexDirection="column" paddingX={1}>
      {mode === 'first-run' ? (
        <Box flexDirection="column">
          <Text>Ask questions in plain English, or use commands.</Text>
          <Text dimColor>Only plain English needs an Anthropic account. Commands do not.</Text>
          <Box marginTop={1}>
            <Text dimColor>
              {'After this, connect a venue — type / and pick one. tula shows nothing until\nit can read a real account, and it only ever asks for read-only keys.'}
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text>
            {'Plain English  '}
            <Text color={source === 'none' ? theme.danger : theme.accent}>{credentialSummary(source)}</Text>
          </Text>
          {cannotChange && (
            <Box marginTop={1}>
              <Text dimColor>{cannotChange}</Text>
            </Box>
          )}
        </Box>
      )}

      {waiting !== null ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.accent}>Waiting for you to finish signing in…</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              {'A browser window should have opened. If it did not, run this in another\nterminal:  ant auth login'}
            </Text>
            <Text dimColor>
              {'\nThe Anthropic CLI keeps the token, not tula. Press Enter when it is done,\nEsc to cancel.'}
            </Text>
          </Box>
        </Box>
      ) : entering ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Paste the key, then press Enter. It stays hidden. Esc to go back.</Text>
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
          <Text dimColor>{`  saved in ${secrets.locationHint()}, mode 600, sent only to Anthropic`}</Text>
          {error && <Text color={theme.danger}>{`  ${error}`}</Text>}
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {choices.map((option, index) =>
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
