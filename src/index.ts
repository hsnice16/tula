import { ask, askFields } from './cli/prompt.js'
import { forgetCommand, nearestCommand, useSurface } from './cli/registry.js'
import { Session } from './cli/session.js'
import { dispatchCommand, parseCommand } from './cli/shell.js'
import { CONNECTORS } from './connectors/registry.js'
import { isOverScoped, overScopedPowers, retired, unverified } from './connectors/types.js'
import { remote, TulaError } from './core/errors.js'
import { buildOracle } from './prices/providers.js'
import { runApp } from './ui/run.js'
import { envApiKey } from './agent/agent.js'
import * as secrets from './secrets/store.js'
import { APP_DESCRIPTION, APP_NAME, APP_VERSION } from './version.js'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

/**
 * Which of the venue's stored entries this connect is about to overwrite, or
 * null for one that joins them.
 *
 * Asked before the credential is typed, because the answer changes what the
 * reader is being asked to fetch — a replacement is the key they just rotated,
 * an addition is a different account. Only ever asked on a terminal: `ask()`
 * off one reads the pipe, so a question here would eat the address a script was
 * feeding in, and there is no way to name an entry in a run nobody is watching.
 * Unattended, the safe answer is the one that deletes nothing.
 */
async function chooseEntry(
  name: string,
  addressOnly: boolean,
  held: readonly secrets.StoredCredential[],
  command: string,
): Promise<secrets.StoredCredential | null> {
  const noun = addressOnly
    ? held.length === 1
      ? 'address'
      : 'addresses'
    : `read-only key${held.length === 1 ? '' : 's'}`
  console.log(`${name} already holds ${held.length} ${noun}:`)
  for (const [at, entry] of held.entries()) {
    console.log(`  ${at + 1}  ${secrets.credentialLabel(entry)}`)
  }

  if (!process.stdin.isTTY) {
    console.log(
      '  Adding to them: replacing one needs a terminal to name it on, and a run\n' +
        `  nobody is watching may not delete a credential. Run ${command} in your\n` +
        '  own shell to replace one instead.\n',
    )
    return null
  }

  const answer = await ask(
    `  Type a to add another, or 1-${held.length} to replace that one: `,
    { hidden: false, command },
  )
  if (answer.toLowerCase() === 'a') {
    console.log()
    return null
  }
  const at = Number.parseInt(answer, 10)
  const chosen = Number.isInteger(at) && at >= 1 && at <= held.length ? held[at - 1] : undefined
  if (!chosen) {
    fail(
      `"${answer}" is neither a nor a number between 1 and ${held.length}.\n` +
        `Nothing was changed. Run ${command} again.`,
    )
  }
  console.log()
  return chosen
}

/**
 * The gate in front of the one thing connecting can destroy. The same shape as
 * `confirmForget`: the venue's own name typed out, never Enter alone — and it
 * is asked with the new credential already verified, so agreeing to it is the
 * last step rather than a bet on one that has not been made yet.
 */
async function confirmReplace(
  venueId: string,
  target: secrets.StoredCredential,
  addressOnly: boolean,
  command: string,
): Promise<void> {
  console.log(`Replace ${secrets.credentialLabel(target)}?`)
  console.log(
    addressOnly
      ? `  tula forgets that address and reads ${venueId} from the new one instead.`
      : `  tula deletes that key from ${secrets.locationHint()}. A venue shows a secret key\n` +
          '  once, so the way back is a new key there, not an undo.',
  )
  const typed = await ask(`  Type ${venueId} to confirm: `, { hidden: false, command })
  if (typed !== venueId) fail(`Kept ${secrets.credentialLabel(target)}. Nothing was replaced.`)
}

async function connect(venueId: string | undefined): Promise<void> {
  const known = [...CONNECTORS.keys()].join(', ')
  if (!venueId) fail(`Usage: tula connect <venue>\nAvailable: ${known}`)
  const connector = CONNECTORS.get(venueId)
  if (!connector) fail(retired(venueId, forgetCommand(venueId)) ?? `Unknown venue "${venueId}". Available: ${known}`)

  console.log(`Connecting ${connector.venue.name}.`)
  // Wallet, Hyperliquid and Aave read a public address and hold no credential
  // at all, so this advice does not merely not apply there — it describes a key
  // they will never be asked for.
  if (connector.fields.some((f) => f.secret)) {
    console.log('Use a read-only key: query permissions only, no trading, no withdrawals.')
  }
  console.log('tula never asks for a seed phrase or private key.\n')

  for (const link of connector.help) console.log(`  ${link.label}  ${link.url}`)
  if (connector.help.length > 0) console.log()

  const command = `tula connect ${venueId}`
  const addressOnly = connector.fields.every((f) => !f.secret)
  const held = await secrets.listCredentials(venueId)
  const replacing =
    held.length > 0
      ? await chooseEntry(connector.venue.name, addressOnly, held, command)
      : null

  const creds = await askFields(connector.fields, { command })

  process.stdout.write('\nVerifying key scope... ')

  let scope
  try {
    scope = await connector.verifyScope(creds)
  } catch (err) {
    console.log('failed.')
    fail(err instanceof Error ? err.message : remote(String(err)))
  }
  console.log('done.\n')

  if (!scope.canRead) fail('This key cannot read balances. Enable read access and try again.')
  if (isOverScoped(scope)) {
    fail(
      `Refusing this key: it can ${overScopedPowers(scope).join(' and ')}.\n` +
        'tula is read-only and will not hold a key that can move your funds.\n' +
        'Create a new key with query permissions only, then run this again.',
    )
  }

  if (replacing) {
    await confirmReplace(venueId, replacing, addressOnly, command)
    await secrets.replaceCredential(venueId, replacing.id, creds)
    console.log(`\nReplaced ${secrets.credentialLabel(replacing)} in ${secrets.locationHint()} (mode 600).`)
  } else {
    const added = await secrets.put(venueId, creds)
    console.log(`Saved ${connector.venue.name} to ${secrets.locationHint()} (mode 600).`)
    // A venue that now holds more than one is a venue whose figures are about
    // to be split between them, and nothing else on this surface would say so.
    if (held.length > 0) {
      console.log(
        `${connector.venue.name} now reads ${held.length + 1} accounts, this one included; every\n` +
          `figure covers all of them. Drop one with: tula ${venueId} disconnect ${secrets.credentialRef(added)}`,
      )
    }
  }

  const unproven = unverified(scope)
  if (unproven.length > 0) {
    console.log(
      `\nNote: ${connector.venue.name} exposes no way to read a key's permissions, so tula\n` +
        `could not confirm this key cannot ${unproven.join(' or ')}. It probes only endpoints\n` +
        'that cannot move money. Verify the key on the venue itself.',
    )
  }
}

/**
 * The venue a command is about to take off disk, or null. `tula forget kraken`
 * and `tula kraken disconnect` are the same act spelled two ways, and the shell
 * gates both — this is the same gate for the path that does not go through it.
 */
function forgets(name: string, args: string[]): { venue: string; ref?: string; all: boolean } | null {
  // `tula forget <venue>` means everything stored for it; `tula <venue>
  // disconnect` means one account, and asks which where there is a choice.
  if (name === 'forget') return args[0] ? { venue: args[0], all: true } : null
  if (args[0] === 'disconnect') {
    // `tula wallet disconnect vault` names one of a set, and the confirmation
    // has to be about the same one.
    const ref = args[1]
    return ref ? { venue: name, ref, all: false } : { venue: name, all: false }
  }
  return null
}

/**
 * An exchange shows a secret key once, so deleting tula's copy is not undoable
 * from inside tula. The shell asks for the venue's name to be typed; here the
 * same word is asked for, and never taken from Enter — Enter is the key that
 * ran the command in the first place.
 *
 * With no terminal to ask on, the answer has to be on the command line already:
 * a script's stdin is not consent, and reading one as a yes is how a piped run
 * deletes a credential nobody meant to name.
 */
async function confirmForget(
  venueId: string,
  command: string,
  ref: string | undefined,
  all: boolean,
): Promise<void> {
  const connector = CONNECTORS.get(venueId)
  const name = connector?.venue.name ?? venueId
  const addressOnly = connector?.fields.every((f) => !f.secret) ?? false

  // What is going, named. A venue may hold several accounts, and "what is
  // stored for Wallet" is three deletions where the reader agreed to one.
  const held = await secrets.listCredentials(venueId)
  const named = ref ? await secrets.findCredential(venueId, ref) : undefined
  // Nothing is about to be deleted: a ref that matches nothing, and a bare
  // disconnect over a venue that will ask which one instead. Confirming a
  // deletion and then being told it did not happen teaches people to type the
  // confirmation faster, which is the opposite of what it is for.
  if (ref && !named) return
  if (!ref && !all && held.length > 1) return

  if (!process.stdin.isTTY) {
    fail(
      `Refusing to forget ${name} without a terminal to confirm on.\n` +
        `  Run it in your shell, or say so on the command line:  ${command} --yes`,
    )
  }

  const going = named ? [named] : held
  const kept = held.length - going.length

  console.log(`Forget ${name}?`)
  if (going.length > 1 || kept > 0) {
    for (const entry of going) console.log(`  ${secrets.credentialLabel(entry)}`)
    if (kept > 0) console.log(`  The other ${kept} stay, and so do their positions.`)
  }
  console.log(
    addressOnly
      ? `  tula forgets the address it reads ${name} from. Reconnecting takes the same address again.`
      : `  tula deletes what is stored for ${name}, from ${secrets.locationHint()}.` +
          '\n  An exchange shows a secret key once, so the way back is a new key there, not an undo.',
  )
  const typed = await ask(`  Type ${venueId} to confirm: `, { hidden: false, command })
  if (typed !== venueId) fail(`Kept ${name}. Nothing was deleted.`)
}

function usage(): string {
  return [
    `tula ${APP_VERSION} — ${APP_DESCRIPTION}`,
    '',
    '  tula                    open the shell — ask questions or use /commands',
    '  tula connect <venue>    connect a venue — a public address, or a read-only key',
    '  tula <command> [args]   run one command and exit (exposure, breaks, shock, ...)',
    '  tula help               every command',
    '  tula --version',
    '',
    `Venues in this build: ${[...CONNECTORS.keys()].join(', ')}`,
  ].join('\n')
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2)
  // Naming a command means this run ends at a shell prompt, so every remedy
  // printed from here has to be something that can be typed at one: `/kraken
  // connect` pasted into a real shell is a path that does not exist.
  if (command !== undefined) useSurface('cli')
  // The one flag, and it means only "I have already read the confirmation".
  const confirmed = argv.includes('--yes')
  const args = argv.filter((a) => a !== '--yes')

  const stored = await secrets.getPriceSource()
  const { oracle, note } = buildOracle(
    stored?.provider,
    stored?.apiKey ? { apiKey: stored.apiKey } : undefined,
  )
  if (note) console.error(note)
  const session = new Session(CONNECTORS, oracle)

  if (command === undefined) {
    if (!process.stdin.isTTY) {
      console.log(usage())
      return
    }
    await session.ensureLoaded()
    // The environment wins over the stored key, so a shell export can override
    // what is on disk without editing the file.
    const apiKey = envApiKey() ?? (await secrets.getProviderKey())
    await runApp(session, CONNECTORS, apiKey, await secrets.listVenues())
    return
  }

  switch (command) {
    // `-v` is the version, not a verbosity flag: there is no verbose mode to
    // claim the letter, and it is what node, npm and bun taught people to type.
    case '--version':
    case '-v':
    case 'version':
      console.log(`${APP_NAME} ${APP_VERSION}`)
      return
    case 'connect':
      await connect(args[0])
      return
    case '--help':
    case '-h':
      console.log(usage())
      return
  }

  // One-shot mode accepts the command with or without its slash.
  const parsed = parseCommand(
    command.startsWith('/') ? command : `/${command}`,
    [...CONNECTORS.keys()],
  )
  if (!parsed || !parsed.known) {
    // `tula circle` reaches here rather than the dispatcher, and the usage text
    // would answer a venue this build dropped by not mentioning it at all.
    const gone = parsed && retired(parsed.name, forgetCommand(parsed.name))
    if (gone) {
      console.log(gone)
      process.exitCode = 1
      return
    }
    // The usage block on its own says every command there is and not which of
    // them the typed word failed to be. The shell has named the word and
    // offered the nearest match since the first release; this path printed a
    // wall of text and exited 1, which reads as the command having run.
    const guess = parsed && nearestCommand(parsed.name)
    console.log(
      `Unknown command "${command}".` +
        (guess ? ` Did you mean:  tula ${guess}` : '') +
        `\n\n${usage()}`,
    )
    process.exitCode = 1
    return
  }
  // Without the stored venues, every `/<venue> <sub>` reports "not connected".
  // A venue this build dropped is stored and is not one of these: listed here
  // it became a row in `tula help` naming a venue nobody can use, with nothing
  // beside it to say why.
  const storedVenues = await secrets.listVenues()
  const venueEntries = storedVenues
    .filter((id) => CONNECTORS.has(id))
    .map((id) => ({
      id,
      connected: true,
      addressOnly: !CONNECTORS.get(id)?.fields.some((f) => f.secret),
      detail: 'connected',
    }))
  const target = forgets(parsed.name, args)
  if (target && storedVenues.includes(target.venue) && !confirmed) {
    await confirmForget(
      target.venue,
      `tula ${command} ${args.join(' ')}`.trimEnd(),
      target.ref,
      target.all,
    )
  }
  const result = await dispatchCommand(session, CONNECTORS, { ...parsed, args }, venueEntries)
  if (result.kind === 'connect') {
    await connect(result.venue)
    return
  }
  if (result.kind === 'connect-price') {
    console.log(
      `Setting an API key for ${result.provider} only works inside the shell, so it is never\n` +
        'typed where a shell history or a process list could keep it. Run: tula',
    )
    process.exitCode = 1
    return
  }
  if (result.kind === 'ui') {
    // /login, /clear and /exit only mean something inside the shell.
    console.log(`/${parsed.name} only works inside the shell. Run: tula`)
    process.exitCode = 1
    return
  }
  console.log(result.output)
  if (result.incomplete || result.usageError) process.exitCode = 1
}

try {
  await main()
} catch (err) {
  if (err instanceof TulaError) fail(err.message)
  throw err
}

// The work is finished and the output is written, but a venue that never
// answered leaves a socket the runtime keeps waiting on — 75s on macOS, long
// after `request()` gave up on it and said so. Exiting explicitly is the
// difference between a command that reported a failed venue and one that looks
// like it hung. Bun flushes stdout synchronously, so nothing is truncated.
process.exit(process.exitCode ?? 0)
