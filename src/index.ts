import { ask } from './cli/prompt.js'
import { Session } from './cli/session.js'
import { dispatchCommand, parseCommand } from './cli/shell.js'
import { aaveConnector } from './connectors/aave.js'
import { binanceConnector } from './connectors/binance.js'
import { circleConnector } from './connectors/circle.js'
import { coinbaseConnector } from './connectors/coinbase.js'
import { hyperliquidConnector } from './connectors/hyperliquid.js'
import { krakenConnector } from './connectors/kraken.js'
import { stripeConnector } from './connectors/stripe.js'
import { walletConnector } from './connectors/wallet.js'
import { isOverScoped, unverified, type Connector } from './connectors/types.js'
import { TulaError } from './core/errors.js'
import { buildOracle } from './prices/providers.js'
import { runApp } from './ui/run.js'
import { envApiKey } from './agent/agent.js'
import * as secrets from './secrets/store.js'
import { APP_DESCRIPTION, APP_VERSION } from './version.js'

// The three that need only a public address come first: they are the cheapest
// thing a new user can safely connect. The menu sorts alphabetically; this order
// is what `tula help` and `/about` list.
const CONNECTORS = new Map<string, Connector>(
  [
    walletConnector,
    hyperliquidConnector,
    aaveConnector,
    krakenConnector,
    coinbaseConnector,
    binanceConnector,
    stripeConnector,
    circleConnector,
  ].map((c) => [
    c.venue.id,
    c,
  ]),
)

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function connect(venueId: string | undefined): Promise<void> {
  const known = [...CONNECTORS.keys()].join(', ')
  if (!venueId) fail(`Usage: tula connect <venue>\nAvailable: ${known}`)
  const connector = CONNECTORS.get(venueId)
  if (!connector) fail(`Unknown venue "${venueId}". Available: ${known}`)

  console.log(`Connecting ${connector.venue.name}.`)
  console.log('Use a read-only key: query permissions only, no trading, no withdrawals.')
  console.log('tula never asks for a seed phrase or private key.\n')

  const invocation = `tula connect ${venueId}`
  const apiKey = await ask('  API key:    ', { hidden: false, command: invocation })
  const apiSecret = await ask('  API secret: ', { hidden: true, command: invocation })
  if (!apiKey || !apiSecret) fail('Both values are required.')

  const creds = { apiKey, apiSecret }
  process.stdout.write('\nVerifying key scope... ')

  let scope
  try {
    scope = await connector.verifyScope(creds)
  } catch (err) {
    console.log('failed.')
    fail(err instanceof Error ? err.message : String(err))
  }
  console.log('done.\n')

  if (!scope.canRead) fail('This key cannot read balances. Enable read access and try again.')
  if (isOverScoped(scope)) {
    const powers = [scope.canTrade === true && 'trade', scope.canWithdraw === true && 'withdraw']
      .filter(Boolean)
      .join(' and ')
    fail(
      `Refusing this key: it can ${powers}.\n` +
        'tula is read-only and will not hold a key that can move your funds.\n' +
        'Create a new key with query permissions only, then run this again.',
    )
  }

  await secrets.put(venueId, creds)
  console.log(`Saved ${connector.venue.name} to ${secrets.locationHint()} (mode 600).`)

  const unproven = unverified(scope)
  if (unproven.length > 0) {
    console.log(
      `\nNote: ${connector.venue.name} exposes no way to read a key's permissions, so tula\n` +
        `could not confirm this key cannot ${unproven.join(' or ')}. It probes only endpoints\n` +
        'that cannot move money. Verify the key on the venue itself.',
    )
  }
}

function usage(): string {
  return [
    `tula ${APP_VERSION} — ${APP_DESCRIPTION}`,
    '',
    '  tula                    open the shell — ask questions or use /commands',
    '  tula connect <venue>    connect a venue with a read-only key',
    '  tula <command> [args]   run one command and exit (exposure, breaks, shock, ...)',
    '  tula help               every command',
    '  tula --version',
    '',
    `Venues in this build: ${[...CONNECTORS.keys()].join(', ')}`,
  ].join('\n')
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)

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
    case '--version':
    case 'version':
      console.log(`${APP_VERSION} (tula)`)
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
    console.log(usage())
    process.exitCode = 1
    return
  }
  // Without the stored venues, every `/<venue> <sub>` reports "not connected".
  const storedVenues = await secrets.listVenues()
  const venueEntries = storedVenues.map((id) => ({ id, connected: true, detail: '' }))
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
