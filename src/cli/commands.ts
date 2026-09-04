import Decimal from 'decimal.js'
import { envApiKey, envApiKeyName, hasAmbientCredentials } from '../agent/agent.js'
import type { Connector } from '../connectors/types.js'
import type { VenueKind } from '../core/position.js'
import type { PriceProvider } from '../prices/providers.js'
import { portfolioValue, type PortfolioValue } from '../core/exposure.js'
import { healthFactorUnder, scenario, whatBreaksFirst, type Shock } from '../core/risk.js'
import { freshness, holdings, pct, quantity, usd } from '../core/format.js'
import { renderTable } from '../ui/table.js'
import * as secrets from '../secrets/store.js'
import { APP_DESCRIPTION, APP_NAME, APP_VERSION, IS_PRE_RELEASE, REPO_URL } from '../version.js'
import type { Session } from './session.js'

export interface CommandResult {
  output: string
  /** Something the user must know is missing. Drives a non-zero exit. */
  incomplete?: boolean
  /** The command was not usable as written. Also a non-zero exit, so a typo in
   *  a script is not mistaken for success. */
  usageError?: boolean
}

function incompleteNote(session: Session): string {
  const { failures, priceError } = session.current
  const lines: string[] = []
  if (failures.length > 0) {
    lines.push(`\nINCOMPLETE — ${failures.length} venue(s) failed. This is not your full exposure.`)
    for (const f of failures) lines.push(`  ${f}`)
    // Some failures already name their own remedy; a second, generic suggestion
    // that does not apply is worse than none.
    if (!failures.some((f) => f.includes('/'))) {
      const first = failures[0]?.split(':')[0]
      lines.push(`  Run /${first ?? '<venue>'} status to see why, or /refresh to try again.`)
    }
  }
  if (priceError) lines.push(`\nPrices unavailable: ${priceError}`)
  return lines.join('\n')
}

/**
 * Naming every one floods the screen on a large book — 43 symbols on one line
 * when a price source is down — so the count leads and the largest few follow.
 * Shared because `exposure` and `shock` describe the same gap, and the one that
 * grew its own copy is the one that flooded.
 */
function unpricedNote({ total, unpriced }: PortfolioValue): string[] {
  if (unpriced.length === 0) return []
  const shown = unpriced.slice(0, 6).join(', ')
  const rest = unpriced.length - 6
  return [
    total === null
      ? `No price for any of ${unpriced.length} asset(s), so there is no total:`
      : `${unpriced.length} asset(s) had no price and are excluded from the total:`,
    `  ${shown}${rest > 0 ? `, and ${rest} more` : ''}`,
  ]
}

/**
 * An empty book has two causes that need opposite advice, and telling someone
 * with a connected wallet to go connect a venue is how a working tool reads as
 * a broken one. Which it is depends on the store, not on the row count.
 */
async function emptyBook(): Promise<string> {
  const stored = await secrets.listVenues()
  if (stored.length === 0) {
    return (
      'No venue is connected yet, so there is nothing to measure.\n' +
      '  Type / and pick one. Wallet, Hyperliquid and Aave need only a public\n' +
      '  address — no key, nothing to leak.'
    )
  }
  const named = stored.join(', ')
  return (
    `${named} ${stored.length === 1 ? 'is' : 'are'} connected and returned nothing.\n` +
    '  Either the account is empty, or it is not the one you trade with.\n' +
    `  /${stored[0]} status shows what tula is reading; /refresh refetches now.`
  )
}

export async function positions(session: Session): Promise<CommandResult> {
  const { positions: all } = await session.ensureLoaded()
  const note = incompleteNote(session)
  if (all.length === 0) {
    return { output: (await emptyBook()) + note, incomplete: note !== '' }
  }

  const now = new Date()
  const sorted = [...all].sort(
    (a, b) =>
      a.venue.localeCompare(b.venue) || a.asset.localeCompare(b.asset) || a.kind.localeCompare(b.kind),
  )
  const table = renderTable(
    ['VENUE', 'KIND', 'ASSET', 'QUANTITY', 'AS OF'],
    sorted.map((p) => [p.venue, p.kind, p.asset, quantity(p.quantity), freshness(p.asOf, now)]),
    ['left', 'left', 'left', 'right', 'left'],
  )
  return { output: table + note, incomplete: note !== '' }
}

export async function exposure(session: Session): Promise<CommandResult> {
  await session.ensureLoaded()
  const exposures = session.exposures()
  const note = incompleteNote(session)
  if (exposures.length === 0) {
    return { output: (await emptyBook()) + note, incomplete: note !== '' }
  }

  const now = new Date()
  const table = renderTable(
    ['ASSET', 'NET', 'NOTIONAL', 'VENUES', 'AS OF'],
    exposures.map((e) => [
      e.asset,
      quantity(e.delta),
      usd(e.notional),
      [...new Set(e.contributors.map((c) => c.venue))].join(' '),
      freshness(e.asOf, now),
    ]),
    ['left', 'right', 'right', 'left', 'left'],
  )

  const value = portfolioValue(exposures)
  const lines = [table, '', `Net value  ${usd(value.total)}`, ...unpricedNote(value)]
  return { output: lines.join('\n') + note, incomplete: note !== '' }
}

export async function breaks(session: Session): Promise<CommandResult> {
  const { positions: all, prices } = await session.ensureLoaded()
  const risks = whatBreaksFirst(all, prices)
  const note = incompleteNote(session)
  if (risks.length === 0) {
    return {
      output:
        'Nothing here can be liquidated — no leverage, no borrowing, nothing to call.\n' +
        '  Spot balances cannot be taken from you, so there is nothing to rank.' +
        note,
      incomplete: note !== '',
    }
  }

  const now = new Date()
  const table = renderTable(
    ['VENUE', 'ASSET', 'KIND', 'MOVE TO LIQ', 'TRIGGER', 'AS OF'],
    risks.map((r) => {
      const p = r.position
      const trigger =
        p.liquidation?.healthFactor !== undefined
          ? `health factor ${p.liquidation.healthFactor.toFixed(2)}`
          : p.liquidation?.price !== undefined
            ? `liq price ${p.liquidation.price.toFixed(2)}`
            : 'unknown'
      return [
        p.venue,
        p.asset,
        p.kind,
        r.move === null ? 'unknown' : pct(r.move),
        trigger,
        freshness(p.asOf, now),
      ]
    }),
    ['left', 'left', 'left', 'right', 'left', 'left'],
  )
  return { output: table + note, incomplete: note !== '' }
}

export async function shock(session: Session, args: string[]): Promise<CommandResult> {
  const shocks: Shock[] = []
  for (let i = 0; i + 1 < args.length; i += 2) {
    const asset = args[i]?.toUpperCase()
    const raw = args[i + 1]?.replace('%', '')
    if (!asset || raw === undefined || raw === '' || Number.isNaN(Number(raw))) {
      return { output: 'Usage: shock <ASSET> <PERCENT>   e.g. shock ETH -20', usageError: true }
    }
    shocks.push({ asset, pct: new Decimal(raw).div(100) })
  }
  if (shocks.length === 0) {
    return { output: 'Usage: shock <ASSET> <PERCENT>   e.g. shock ETH -20', usageError: true }
  }

  const { positions: all, prices } = await session.ensureLoaded()
  const result = scenario(all, prices, shocks)
  const note = incompleteNote(session)

  const heading = shocks.map((s) => `${s.asset} ${pct(s.pct, 0)}`).join(', ')
  const lines = [
    `Scenario: ${heading}`,
    '',
    `  Before   ${usd(result.before.total)}`,
    `  After    ${usd(result.after.total)}`,
    `  Change   ${usd(result.change)}`,
  ]

  lines.push(...unpricedNote(result.before).map((l) => `  ${l}`))

  const shockedHealth = all.flatMap((p) => {
    const hf = p.liquidation?.healthFactor
    const move = shocks.find((s) => s.asset === p.asset)?.pct
    if (hf === undefined || move === undefined) return []
    return [`  ${p.venue}  health factor ${hf.toFixed(2)} -> ${healthFactorUnder(hf, move).toFixed(2)}`]
  })
  if (shockedHealth.length > 0) {
    lines.push('', 'Health factors:', ...shockedHealth)
  }

  lines.push('')
  if (result.liquidated.length === 0) {
    lines.push('Nothing liquidates at this level.')
  } else {
    lines.push('LIQUIDATED:')
    for (const p of result.liquidated) lines.push(`  ${p.venue}  ${p.kind} ${p.asset}`)
  }

  return { output: lines.join('\n') + note, incomplete: note !== '' }
}

export async function venues(
  session: Session,
  connectors: Map<string, Connector>,
): Promise<CommandResult> {
  const { positions: all, failures } = await session.ensureLoaded()
  const now = new Date()
  const stored = await secrets.listVenues()

  const rows = stored.map((venueId) => {
    const failure = failures.find((f) => f.startsWith(`${venueId}:`))
    if (failure) return [venueId, '—', '—', `FAILED: ${failure.split(': ').slice(1).join(': ')}`]

    const mine = all.filter((p) => belongsToVenue(p.venue, venueId))
    if (mine.length === 0) return [venueId, '0', '—', 'connected, holding nothing']

    const stalest = mine.reduce((min, p) => (p.asOf < min ? p.asOf : min), now)
    return [venueId, String(mine.length), freshness(stalest, now), 'ok']
  })

  // A failure whose venue is no longer stored still has to be said out loud.
  for (const failure of failures) {
    const [venue = '?', ...rest] = failure.split(': ')
    if (!stored.includes(venue)) rows.push([venue, '—', '—', `FAILED: ${rest.join(': ')}`])
  }

  const lines = [
    rows.length > 0
      ? renderTable(['VENUE', 'HOLDINGS', 'AS OF', 'STATUS'], rows, ['left', 'right', 'left', 'left'])
      : 'No venues connected yet. Type / and pick one.',
    '',
    `Connectors in this build: ${[...connectors.keys()].join(', ')}`,
  ]
  return { output: lines.join('\n'), incomplete: failures.length > 0 }
}


/**
 * A venue may label its rows with sub-accounts — `kraken-margin` beside
 * `kraken` — so a venue filter has to accept its own prefixed labels.
 */
export function belongsToVenue(positionVenue: string, venueId: string): boolean {
  return positionVenue === venueId || positionVenue.startsWith(`${venueId}-`)
}

export async function positionsAt(
  session: Session,
  venueId: string,
  kind: VenueKind = 'cex',
): Promise<CommandResult> {
  const { positions: all } = await session.ensureLoaded()
  const mine = all.filter((p) => belongsToVenue(p.venue, venueId))
  if (mine.length === 0) {
    return {
      output:
        `${venueId} returned ${kind === 'wallet' ? 'no tokens' : 'nothing'}.\n` +
        '  Either the account is empty, or it is not the one you meant to connect.\n' +
        `  /${venueId} status shows what tula is reading; /${venueId} connect replaces it.` +
        incompleteNote(session),
    }
  }
  const now = new Date()
  return {
    output:
      renderTable(
        ['KIND', 'ASSET', 'QUANTITY', 'AS OF'],
        mine
          .sort((a, b) => a.asset.localeCompare(b.asset) || a.kind.localeCompare(b.kind))
          .map((p) => [p.kind, p.asset, quantity(p.quantity), freshness(p.asOf, now)]),
        ['left', 'left', 'right', 'left'],
      ) + incompleteNote(session),
  }
}

export async function breaksAt(session: Session, venueId: string): Promise<CommandResult> {
  const { positions: all, prices } = await session.ensureLoaded()
  const risks = whatBreaksFirst(
    all.filter((p) => belongsToVenue(p.venue, venueId)),
    prices,
  )
  if (risks.length === 0) return { output: `Nothing at ${venueId} can be liquidated.` }

  const now = new Date()
  return {
    output: renderTable(
      ['ASSET', 'KIND', 'MOVE TO LIQ', 'TRIGGER', 'AS OF'],
      risks.map((r) => {
        const p = r.position
        const trigger =
          p.liquidation?.healthFactor !== undefined
            ? `health factor ${p.liquidation.healthFactor.toFixed(2)}`
            : p.liquidation?.price !== undefined
              ? `liq price ${p.liquidation.price.toFixed(2)}`
              : 'unknown'
        return [
          p.asset,
          p.kind,
          r.move === null ? 'unknown' : pct(r.move),
          trigger,
          freshness(p.asOf, now),
        ]
      }),
      ['left', 'left', 'right', 'left', 'left'],
    ),
  }
}

export async function venueStatus(
  session: Session,
  connector: Connector,
  connected: boolean,
): Promise<CommandResult> {
  const { positions: all, failures } = await session.ensureLoaded()
  const mine = all.filter((p) => belongsToVenue(p.venue, connector.venue.id))
  const failure = failures.find((f) => f.startsWith(`${connector.venue.id}:`))
  const now = new Date()

  const lines = [`${connector.venue.name}  (${connector.venue.kind})`, '']
  if (!connected) {
    lines.push('  Not connected.', `  Connect with:  /${connector.venue.id} connect`)
  } else if (failure) {
    lines.push(`  FAILED — ${failure.split(': ').slice(1).join(': ')}`)
    lines.push('  Numbers elsewhere in tula do not include this venue.')
  } else {
    const stalest = mine.reduce((min, p) => (p.asOf < min ? p.asOf : min), now)
    lines.push(`  ${holdings(connector.venue.kind, mine)}, oldest ${freshness(stalest, now)}`)
    lines.push('  Key scope was verified read-only when you connected.')
  }

  if (connector.help.length > 0) {
    lines.push('', '  Official:')
    for (const link of connector.help) lines.push(`    ${link.label}  ${link.url}`)
  }
  return { output: lines.join('\n'), incomplete: Boolean(failure) }
}

export function venueDocs(connector: Connector): CommandResult {
  if (connector.help.length === 0) {
    return { output: `No official links recorded for ${connector.venue.name}.` }
  }
  const width = Math.max(...connector.help.map((l) => l.label.length))
  return {
    output: [
      `${connector.venue.name} — official documentation`,
      '',
      ...connector.help.map((l) => `  ${l.label.padEnd(width)}  ${l.url}`),
    ].join('\n'),
  }
}

/** Which credential the agent would use, and therefore what /login can change. */
export type CredentialSource = 'env' | 'stored' | 'ambient' | 'none'

/**
 * Resolved in the order `src/index.ts` resolves it, so every screen that names
 * the credential names the one a question would actually go out with.
 */
export async function credentialSource(): Promise<CredentialSource> {
  if (envApiKey()) return 'env'
  if (await secrets.getProviderKey()) return 'stored'
  return hasAmbientCredentials() ? 'ambient' : 'none'
}

/**
 * The state as a status value: /about's row and the /login screen's heading.
 * The way out is not in it — /login is not advice to someone already on it.
 */
export function credentialSummary(source: CredentialSource): string {
  if (source === 'env') return `on · using ${credentialName(source)}`
  if (source === 'stored') return 'on · using an API key tula saved'
  if (source === 'ambient') return 'on · signed in with your Anthropic account, no key saved'
  return 'off · no key, and not signed in'
}

/**
 * The same credential named mid-sentence, where the status wording reads as an
 * interruption. Kept apart from the summary above rather than shared: one is a
 * value in a column, the other is a clause, and neither survives the other's job.
 */
export function credentialName(source: CredentialSource): string {
  if (source === 'env') return `${envApiKeyName() ?? 'a key'} from your shell`
  if (source === 'stored') return 'the API key tula saved'
  if (source === 'ambient') return 'your Anthropic account sign-in'
  return 'nothing'
}

/**
 * The trust surface on one screen. Someone deciding whether to point this at
 * their entire net worth should not have to read the README to learn what it
 * structurally cannot do, or where its keys sit.
 */
export async function about(connectors: Map<string, Connector>): Promise<CommandResult> {
  const stored = await secrets.listVenues()
  const connected = stored.filter((id) => connectors.has(id))

  const source = await credentialSource()
  const rows: [string, string][] = [
    [
      'Plain English',
      source === 'none'
        ? `${credentialSummary(source)} — /login, or: ant auth login`
        : credentialSummary(source),
    ],
    ['Venues in build', [...connectors.keys()].join(', ')],
    ['Connected', `${connected.length} of ${connectors.size}`],
    ['Credentials', `${secrets.locationHint()}, mode 600`],
    ['Source', REPO_URL],
  ]
  const width = Math.max(...rows.map(([label]) => label.length))

  return {
    output: [
      `${APP_NAME} ${APP_VERSION}${IS_PRE_RELEASE ? ' — pre-release' : ''}`,
      APP_DESCRIPTION,
      '',
      'Reads every venue you connect, nets them per asset, and ranks what gets',
      'liquidated first. Every figure carries when it was true, and a venue that',
      'fails is named rather than quietly dropped.',
      '',
      'It cannot move funds off a venue, and places no order for the moment —',
      'trading will come later. The build fails if an endpoint for either appears.',
      'It never asks for a seed phrase. The model narrates these numbers; it never',
      'computes them and never sees a credential.',
      '',
      ...rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`),
    ].join('\n'),
  }
}

export function priceDocs(provider: PriceProvider): CommandResult {
  const width = Math.max(...provider.help.map((l) => l.label.length))
  return {
    output: [
      `${provider.name} — official documentation`,
      '',
      ...provider.help.map((l) => `  ${l.label.padEnd(width)}  ${l.url}`),
    ].join('\n'),
  }
}

export function priceStatus(
  provider: PriceProvider,
  active: boolean,
  hasKey: boolean,
): CommandResult {
  const lines = [`${provider.name}  (price source)`, '', `  ${provider.summary}`, '']

  if (active) {
    lines.push('  Active — every figure in tula is priced from here.')
  } else {
    lines.push('  Not the active source.')
    lines.push(
      provider.keyless || hasKey
        ? `  Switch to it with:  /${provider.id} use`
        : `  It needs an API key first:  /${provider.id} connect`,
    )
  }

  if (!provider.keyless) {
    lines.push(
      '',
      hasKey
        ? '  A key is stored for it, mode 600, and is sent only to this source.'
        : '  No key is stored for it.',
    )
    lines.push('  This is a data key: it cannot trade or move funds anywhere.')
  }

  if (provider.help.length > 0) {
    lines.push('', '  Official:')
    for (const link of provider.help) lines.push(`    ${link.label}  ${link.url}`)
  }
  return { output: lines.join('\n') }
}
