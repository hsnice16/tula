import { Box, Text, useApp, useInput } from 'ink'
import { useCallback, useEffect, useState } from 'react'
import {
  isOverScoped,
  overScopedPowers,
  unverified,
  type Connectable,
  type ConnectorCredentials,
  type KeyScope,
} from '../connectors/types.js'
import { connectCommand, typed } from '../core/surface.js'
import { failureText } from '../core/errors.js'
import * as secrets from '../secrets/store.js'
import type { StoredCredential } from '../secrets/store.js'
import { BRAND_MARK, brandColor } from './brand.js'
import { theme } from './theme.js'

interface Props {
  target: Connectable
  onDone: (outcome: { ok: boolean; message: string }) => void
  /**
   * What the venue already holds. Non-empty turns the flow into a question —
   * add another, or replace one of these — because a screen that silently did
   * either would be the way a wallet went missing or a key was overwritten.
   */
  existing?: readonly StoredCredential[]
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
 * How many of a set can be picked with one keystroke. Past this the screen
 * still lists them — a set you cannot see is a set you cannot choose from —
 * and says which command takes one away.
 */
const PICKABLE = 9

/**
 * What the screen is asking for.
 *
 * `pick` exists only where the venue already holds something. `name` is asked
 * only when the entry is joining others, because a name is how two are told
 * apart and there is nothing to tell apart until there are two. `confirm` is
 * the gate in front of the one act here that destroys a credential.
 */
type Step =
  | { kind: 'pick' }
  | { kind: 'fields'; replacing: StoredCredential | null }
  /** The scope travels with the credential rather than being read again: a
   *  second `verifyScope` is a second call to the venue, and one that failed
   *  after a good one would refuse a key tula has already proved read-only. */
  | { kind: 'name'; creds: ConnectorCredentials; scope: KeyScope }
  | { kind: 'confirm'; creds: ConnectorCredentials; scope: KeyScope; replacing: StoredCredential }

/**
 * Connecting in-app rather than as a one-shot command: the venue is chosen from
 * the menu, so the credential prompt has to be here too. Secrets are never
 * echoed and never rendered back, and no step of this screen has a field a seed
 * phrase would be typed into — the only masked input is one the connector
 * declared, and Wallet, Hyperliquid and Aave declare none.
 */
export function ConnectFlow({ target, onDone, existing = [], save: store, doneMessage }: Props) {
  const { exit } = useApp()
  const [step, setStep] = useState<Step>(() =>
    existing.length > 0 ? { kind: 'pick' } : { kind: 'fields', replacing: null },
  )
  const [index, setIndex] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [frame, setFrame] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const field = step.kind === 'fields' ? target.fields[index] : undefined
  // An address-only venue has no key to over-scope, so saying so would be a lie.
  const hasSecret = target.fields.some((f) => f.secret)
  const mark = brandColor(target.id)
  const noun = hasSecret ? 'key' : 'address'
  const nouns = hasSecret ? 'keys' : 'addresses'

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setFrame((f) => f + 1), 80)
    return () => clearInterval(timer)
  }, [busy])

  /** Back to the top, with the reason on screen and nothing half-entered kept. */
  const refuse = useCallback(
    (message: string) => {
      setError(message)
      setIndex(0)
      setValues({})
      setDraft('')
      setStep(existing.length > 0 ? { kind: 'pick' } : { kind: 'fields', replacing: null })
    },
    [existing.length],
  )

  const finish = useCallback(
    (scope: KeyScope) => {
      const unproven = unverified(scope)
      const note =
        unproven.length > 0
          ? ` ${target.name} exposes no way to read a key’s permissions, so tula could not confirm it cannot ${unproven.join(' or ')}.`
          : ''
      onDone({
        ok: true,
        message: doneMessage ? doneMessage(target.name) : `Connected ${target.name}.${note}`,
      })
    },
    [target, onDone, doneMessage],
  )

  /**
   * Writes the credential, and is the only place that does. A duplicate or a
   * clashing name is refused by the store rather than merged — a second entry
   * for one account counts everything in it twice — so it arrives here as an
   * error with the entry it collided with named, and the screen shows it and
   * goes back to the top rather than falling over.
   */
  const settle = useCallback(
    async (
      creds: ConnectorCredentials,
      scope: KeyScope,
      name: string | undefined,
      replacing: StoredCredential | null,
    ) => {
      setBusy(true)
      try {
        if (store) await store(creds)
        else if (replacing) await secrets.replaceCredential(target.id, replacing.id, creds, name)
        else await secrets.put(target.id, creds, name)
        finish(scope)
      } catch (err) {
        // The store's own refusals are `TulaError`s that name their remedy; an
        // `ENOSPC` out of `secrets.put` is not, and it reached this screen as
        // one bare line — on the surface a user least knows what to do on.
        refuse(failureText(err))
      } finally {
        setBusy(false)
      }
    },
    [store, target.id, refuse, finish],
  )

  const verify = useCallback(
    async (creds: ConnectorCredentials, replacing: StoredCredential | null) => {
      setBusy(true)
      setError(null)
      let scope: KeyScope
      try {
        scope = await target.verifyScope(creds)
      } catch (err) {
        // A connector's refusal is rendered whole, remedy line and all: what a
        // venue wrote inside it was already bounded by `remote()` as it entered
        // the connector, which is the only place that can tell tula's own text
        // from somebody else's. Anything that is not one is a bug, and
        // `failureText` is where that distinction is made for every screen.
        refuse(failureText(err))
        return
      } finally {
        setBusy(false)
      }

      if (!scope.canRead) {
        return refuse('That key cannot read balances. Enable read access and try again.')
      }
      if (isOverScoped(scope)) {
        return refuse(
          `Refused: this key can ${overScopedPowers(scope).join(' and ')}. ` +
            'tula is read-only and will not hold a key that ' +
            'can move your funds. Create one with query permissions only.',
        )
      }

      // Nothing is on disk yet on any branch. A credential that failed above
      // must not have cost the reader the one already stored, and a replacement
      // asks its question with the new credential already proved good — so the
      // gate is the last thing between the answer and the deletion.
      if (replacing) return setStep({ kind: 'confirm', creds, scope, replacing })
      if (existing.length > 0) return setStep({ kind: 'name', creds, scope })
      await settle(creds, scope, undefined, null)
    },
    [target, refuse, existing.length, settle],
  )

  useInput((input, key) => {
    // Above the busy gate: verifying a key is a call to the venue, and a wait
    // nothing can interrupt is exactly when somebody reaches for this key. Ink
    // holds raw mode, so unhandled it raises no SIGINT either and the screen
    // simply does not answer. Esc backs out of the connect; ctrl+c leaves tula.
    if (key.ctrl && input === 'c') return exit()
    if (busy) return
    if (key.escape) {
      return onDone({
        ok: false,
        message:
          step.kind === 'confirm'
            ? `Kept ${secrets.credentialLabel(step.replacing)} — nothing was replaced.`
            : `Left ${target.name} unconnected.`,
      })
    }

    if (step.kind === 'pick') {
      if (input === 'a' || input === 'A') return setStep({ kind: 'fields', replacing: null })
      const at = Number.parseInt(input, 10)
      const chosen = Number.isInteger(at) && at >= 1 && at <= PICKABLE ? existing[at - 1] : undefined
      if (chosen) return setStep({ kind: 'fields', replacing: chosen })
      return
    }

    const commit = (raw: string) => {
      const value = raw.trim()
      setDraft('')

      if (step.kind === 'name') {
        // Blank is a real answer: an unnamed entry works, and this venue's
        // entries may already be told apart by their addresses.
        return void settle(step.creds, step.scope, value === '' ? undefined : value, null)
      }
      if (step.kind === 'confirm') {
        // Anything but the venue's own name keeps what is on disk — an empty
        // line included, which is what a second Enter after an overshoot is.
        if (value.toLowerCase() !== target.id.toLowerCase()) {
          return onDone({
            ok: false,
            message:
              `Kept ${secrets.credentialLabel(step.replacing)} — nothing was replaced.\n` +
              `  Run ${connectCommand(target.id)} again if you did mean to replace it.`,
          })
        }
        return void settle(step.creds, step.scope, undefined, step.replacing)
      }

      if (!value || !field) return
      const next = { ...values, [field.name]: value }
      setValues(next)
      if (index + 1 < target.fields.length) return setIndex(index + 1)
      void verify(next, step.replacing)
    }

    if (key.return) return commit(draft)
    if (key.backspace || key.delete) return setDraft((d) => d.slice(0, -1))
    if (key.ctrl || key.meta || key.tab) return
    if (!input) return
    if (/[\r\n]$/.test(input)) return commit(draft + input.replace(/[\r\n]+/g, ''))
    setDraft((d) => d + input.replace(/[\r\n]+/g, ''))
  })

  const line =
    step.kind === 'name'
      ? {
          label: `Name for this ${noun}`,
          hint: 'optional — how you will tell it from the others',
          secret: false,
          footer: 'Enter to save, empty to go without one · Esc to cancel',
        }
      : step.kind === 'confirm'
        ? { label: `Type ${target.id} to confirm`, hint: undefined, secret: false, footer: 'Esc keeps what is stored' }
        : field
          ? {
              label: field.label,
              hint: field.hint,
              secret: field.secret,
              footer: `${index + 1} of ${target.fields.length} · Enter to continue · Esc to cancel`,
            }
          : null

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold wrap="truncate">
        {mark && <Text color={mark}>{`${BRAND_MARK} `}</Text>}
        <Text color={theme.accent}>{`Connect ${target.name}`}</Text>
      </Text>
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

      {step.kind === 'pick' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>{`  ${target.name} already holds ${existing.length} ${existing.length === 1 ? noun : nouns}:`}</Text>
          {/* A list of one needs no index — and given one, the same digit stood
              in the key column twice: once labelling the address, once as the
              key that deletes it. Numbered only where there is something to
              tell apart. */}
          {existing.map((entry, at) => (
            <Text key={entry.id}>
              <Text color={theme.accent}>
                {`  ${existing.length === 1 || at >= PICKABLE ? ' ' : at + 1}  `}
              </Text>
              {secrets.credentialLabel(entry)}
            </Text>
          ))}
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color={theme.accent}>{'  a'}</Text>
              {`  add another ${noun}, and keep ${existing.length === 1 ? 'the one' : 'every one'} above`}
            </Text>
            {/* The one key here that destroys something, drawn in the colour
                this screen already uses for that. The digits above are the same
                keys, so in one accent column a reader met `1` as a bullet and
                `1` as delete, in the same colour, four rows apart. */}
            <Text>
              <Text color={theme.danger}>
                {`  ${existing.length === 1 ? '1' : `1-${Math.min(existing.length, PICKABLE)}`}`}
              </Text>
              {existing.length === 1
                ? `  replace it — the one above is deleted, and you type ${target.id} to confirm`
                : `  replace that ${noun} — it is deleted, and you type ${target.id} to confirm`}
            </Text>
            {existing.length > PICKABLE && (
              <Text dimColor>
                {`  The rest are reached one at a time: ${typed(`${target.id} disconnect <name>`)}`}
              </Text>
            )}
            <Text dimColor>{'  Esc to leave everything as it is'}</Text>
          </Box>
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
      ) : step.kind === 'confirm' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.danger}>
            {`  Replacing ${secrets.credentialLabel(step.replacing)} deletes it from ${secrets.locationHint()}.`}
          </Text>
          <Text dimColor>
            {hasSecret
              ? '  A venue shows a secret key once, so the way back is a new key there, not an undo.'
              : '  Reconnecting takes the same address again — nothing else is lost.'}
          </Text>
        </Box>
      ) : null}

      {!busy && line && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {`  ${line.label}`}
            {line.hint ? <Text dimColor>{`  (${line.hint})`}</Text> : null}
          </Text>
          <Box
            borderStyle="round"
            borderColor={theme.accent}
            borderLeft={false}
            borderRight={false}
            paddingX={1}
          >
            <Text color={theme.accent}>{'❯ '}</Text>
            <Text>{line.secret ? '•'.repeat(Math.min(draft.length, 56)) : draft}</Text>
            <Text inverse> </Text>
          </Box>
          <Text dimColor>{`  ${line.footer}`}</Text>
        </Box>
      )}
    </Box>
  )
}
