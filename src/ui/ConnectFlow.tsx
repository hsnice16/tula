import { Box, Text, useInput } from 'ink'
import { useCallback, useEffect, useState } from 'react'
import { isOverScoped, unverified, type Connectable, type ConnectorCredentials } from '../connectors/types.js'
import * as secrets from '../secrets/store.js'
import { theme } from './theme.js'

interface Props {
  target: Connectable
  onDone: (outcome: { ok: boolean; message: string }) => void
  /**
   * Where the credentials land. Defaults to the venue's own entry; a price
   * source overrides it, because it is not a venue and must never be offered
   * as one by `listVenues`.
   */
  save?: (creds: ConnectorCredentials) => Promise<void>
  /** Replaces "Connected <name>." when the thing connected is not a venue. */
  doneMessage?: (name: string) => string
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Connecting in-app rather than as a one-shot command: the venue is chosen from
 * the menu, so the credential prompt has to be here too. Secrets are never
 * echoed and never rendered back.
 */
export function ConnectFlow({ target, onDone, save: store, doneMessage }: Props) {
  const [index, setIndex] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [frame, setFrame] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const field = target.fields[index]
  // An address-only venue has no key to over-scope, so saying so would be a lie.
  const hasSecret = target.fields.some((f) => f.secret)

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setFrame((f) => f + 1), 80)
    return () => clearInterval(timer)
  }, [busy])

  const save = useCallback(
    async (creds: ConnectorCredentials) => {
      setBusy(true)
      setError(null)
      try {
        const scope = await target.verifyScope(creds)
        if (!scope.canRead) {
          setError('That key cannot read balances. Enable read access and try again.')
          setIndex(0)
          setValues({})
          return
        }
        if (isOverScoped(scope)) {
          const powers = [scope.canTrade === true && 'trade', scope.canWithdraw === true && 'withdraw']
            .filter(Boolean)
            .join(' and ')
          setError(
            `Refused: this key can ${powers}. tula is read-only and will not hold a key that ` +
              'can move your funds. Create one with query permissions only.',
          )
          setIndex(0)
          setValues({})
          return
        }

        await (store ? store(creds) : secrets.put(target.id, creds))
        const unproven = unverified(scope)
        const note =
          unproven.length > 0
            ? ` ${target.name} exposes no way to read a key’s permissions, so tula could not confirm it cannot ${unproven.join(' or ')}.`
            : ''
        onDone({
          ok: true,
          message: doneMessage
            ? doneMessage(target.name)
            : `Connected ${target.name}.${note}`,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setIndex(0)
        setValues({})
      } finally {
        setBusy(false)
      }
    },
    [target, onDone, store, doneMessage],
  )

  useInput((input, key) => {
    if (busy) return
    if (key.escape) return onDone({ ok: false, message: `Left ${target.name} unconnected.` })
    if (!field) return

    const commit = (raw: string) => {
      const value = raw.trim()
      if (!value) return
      const next = { ...values, [field.name]: value }
      setValues(next)
      setDraft('')
      if (index + 1 < target.fields.length) return setIndex(index + 1)
      void save(next)
    }

    if (key.return) return commit(draft)
    if (key.backspace || key.delete) return setDraft((d) => d.slice(0, -1))
    if (key.ctrl || key.meta || key.tab) return
    if (!input) return
    if (/[\r\n]$/.test(input)) return commit(draft + input.replace(/[\r\n]+/g, ''))
    setDraft((d) => d + input.replace(/[\r\n]+/g, ''))
  })

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold color={theme.accent}>{`Connect ${target.name}`}</Text>
      <Text dimColor>
        {hasSecret
          ? 'Use a read-only key. tula verifies that before it stores anything.'
          : 'A public address only. tula never asks for a seed phrase or private key.'}
      </Text>

      {target.help.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {target.help.map((link) => (
            <Text key={link.url} dimColor>{`  ${link.label}  ${link.url}`}</Text>
          ))}
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={theme.danger}>{`  ${error}`}</Text>
        </Box>
      )}

      {busy ? (
        <Box marginTop={1}>
          <Text color={theme.accent}>
            {`  ${SPINNER[frame % SPINNER.length]} ${
              hasSecret ? 'verifying the key can only read…' : 'checking the address…'
            }`}
          </Text>
        </Box>
      ) : field ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {`  ${field.label}`}
            {field.hint ? <Text dimColor>{`  (${field.hint})`}</Text> : null}
          </Text>
          <Box
            borderStyle="round"
            borderColor={theme.accent}
            borderLeft={false}
            borderRight={false}
            paddingX={1}
          >
            <Text color={theme.accent}>{'❯ '}</Text>
            <Text>{field.secret ? '•'.repeat(Math.min(draft.length, 56)) : draft}</Text>
            <Text inverse> </Text>
          </Box>
          <Text dimColor>
            {`  ${index + 1} of ${target.fields.length} · Enter to continue · Esc to cancel`}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
