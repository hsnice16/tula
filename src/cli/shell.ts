import { retired, type Connector } from '../connectors/types.js'
import * as secrets from '../secrets/store.js'
import { update } from '../update/command.js'
import type { DownloadProgress } from '../update/apply.js'
import * as commands from './commands.js'
import {
  buildOracle,
  DEFAULT_PROVIDER,
  PRICE_PROVIDERS,
  priceProvider,
  type PriceProvider,
} from '../prices/providers.js'
import { connectCommand, typed } from '../core/surface.js'
import {
  defaultSubcommand,
  forgetCommand,
  helpText,
  nearestCommand,
  parseCommand,
  priceEntries,
  PRICE_SUBCOMMANDS,
  VENUE_SUBCOMMANDS,
  type ParsedCommand,
  type VenueEntry,
} from './registry.js'
import type { Session } from './session.js'
import { keysText } from '../ui/keymap.js'
import { plural } from '../core/format.js'

export type UiAction = 'exit' | 'clear' | 'login' | 'history' | 'vim'

export type DispatchResult =
  | { kind: 'output'; output: string; note?: string; incomplete?: boolean; usageError?: boolean }
  | { kind: 'ui'; action: UiAction }
  | { kind: 'connect'; venue: string }
  | { kind: 'connect-price'; provider: string }

export { parseCommand }

async function dispatchVenue(
  session: Session,
  connector: Connector,
  connected: boolean,
  args: string[],
): Promise<DispatchResult> {
  const id = connector.venue.id
  const sub = (args[0] ?? defaultSubcommand(connected)).toLowerCase()

  if (!VENUE_SUBCOMMANDS.some((c) => c.name === sub)) {
    const available = VENUE_SUBCOMMANDS.filter((c) => connected || !c.needsConnection)
      .map((c) => c.name)
      .join(', ')
    return { kind: 'output', output: `${typed(id)} has no "${sub}". Try: ${available}`, usageError: true }
  }

  if (sub === 'connect') return { kind: 'connect', venue: id }
  if (sub === 'docs') return { kind: 'output', ...commands.venueDocs(connector) }

  if (!connected) {
    const output =
      `${connector.venue.name} is not connected yet.\n` +
      `  Connect it with:  ${connectCommand(id)}` +
      (connector.help[0] ? `\n  ${connector.help[0].label}:  ${connector.help[0].url}` : '')
    return { kind: 'output', output, note: output }
  }

  switch (sub) {
    case 'positions':
      return { kind: 'output', ...(await commands.positionsAt(session, id, connector.venue.kind)) }
    case 'breaks':
      return { kind: 'output', ...(await commands.breaksAt(session, id, connector.venue.kind)) }
    case 'status':
      return { kind: 'output', ...(await commands.venueStatus(session, connector, connected)) }
    case 'disconnect': {
      const held = await secrets.listCredentials(id)
      const ref = args[1]

      // Which one is a question only the reader can answer, and answering it
      // for them means taking a credential nobody named. `/forget` is the
      // spelling that means all of them, so this one asks instead of guessing.
      if (!ref && held.length > 1) {
        return {
          kind: 'output',
          usageError: true,
          output: [
            `${connector.venue.name} holds ${held.length} addresses, so this needs to say which:`,
            ...held.map((e) => `  ${typed(`${id} disconnect ${secrets.credentialRef(e)}`)}`),
            `  Or ${forgetCommand(id)} to forget every one of them at once.`,
          ].join('\n'),
        }
      }

      if (ref) {
        const target = await secrets.findCredential(id, ref)
        if (!target) {
          return {
            kind: 'output',
            usageError: true,
            output: [
              `${connector.venue.name} has nothing called “${ref}”. It holds:`,
              ...held.map((e) => `  ${secrets.credentialLabel(e)}`),
              `  Name one of those, or ${forgetCommand(id)} to forget the venue.`,
            ].join('\n'),
          }
        }
        const label = secrets.credentialLabel(target)
        await secrets.removeCredential(id, target.id)
        await session.refresh()
        const left = held.length - 1
        return {
          kind: 'output',
          output:
            left > 0
              ? `Forgot ${label}. ${connector.venue.name} still watches ${left} other${left === 1 ? '' : 's'}, and this refresh no longer counts what that one held.`
              : `Forgot ${label}. Nothing is stored for ${connector.venue.name} any more.`,
        }
      }

      await secrets.remove(id)
      await session.refresh()
      return {
        kind: 'output',
        output: `Forgot ${connector.venue.name}. Its credentials are gone from disk.`,
      }
    }
    default:
      return { kind: 'output', output: `${typed(id)} has no "${sub}".` }
  }
}

/**
 * Where to go when a source will not answer. Never the default outright: after
 * a failed switch to it, that is the command that just failed.
 */
export function wayBack(previous: string, failed: string): string {
  if (previous !== failed) return `Go back with:  ${typed(`${previous} use`)}`
  const others = PRICE_PROVIDERS.filter((p) => p.id !== failed && p.keyless)
  if (others.length === 0) return `Every keyless source is unavailable; try again with ${typed('refresh')}.`
  return `Try another source:  ${others.map((p) => typed(`${p.id} use`)).join('  ')}`
}

async function dispatchPrice(
  session: Session,
  provider: PriceProvider,
  args: string[],
): Promise<DispatchResult> {
  const stored = await secrets.getPriceSource()
  const previous = stored?.provider ?? DEFAULT_PROVIDER
  const active = previous === provider.id
  // Only one source is stored at a time, so a key can only exist for the active
  // one. A key kept for a source nobody is using earns nothing and can leak.
  const key = active ? stored?.apiKey : undefined
  const sub = (args[0] ?? (active ? 'status' : 'use')).toLowerCase()

  if (!PRICE_SUBCOMMANDS.some((c) => c.name === sub)) {
    const available = PRICE_SUBCOMMANDS.filter((c) => active || !c.needsConnection)
      .map((c) => c.name)
      .join(', ')
    return {
      kind: 'output',
      output: `${typed(provider.id)} has no "${sub}". Try: ${available}`,
      usageError: true,
    }
  }

  const activate = async (creds?: { apiKey: string }): Promise<DispatchResult> => {
    await secrets.putPriceSource(provider.id, creds?.apiKey)
    const { oracle } = buildOracle(provider.id, creds)
    const loaded = await session.useOracle(oracle)
    if (loaded.priceError) {
      const output =
        `Switched to ${provider.name}, but it did not answer:\n  ${loaded.priceError}\n` +
        `  Quantities are still correct. ${wayBack(previous, provider.id)}`
      return { kind: 'output', incomplete: true, output, note: output }
    }
    const priced = loaded.prices.size
    const held = new Set(loaded.positions.map((p) => p.asset)).size
    // A source that answers 200 and matches nothing prices the book at nothing
    // with `priceError` null, because nothing threw. Held apart from an empty
    // book, which is the same count and not a source that failed at all.
    if (priced === 0 && held > 0) {
      const output =
        `${provider.name} answered, and priced none of your ${held} asset${held === 1 ? '' : 's'}.\n` +
        '  Quantities are still correct; every total is unpriced until a source answers.\n' +
        `  ${wayBack(previous, provider.id)}`
      return {
        kind: 'output',
        output,
        note: output,
        // Not an incomplete view: `isIncomplete` reads the failures and the
        // price error, and neither is set here, so a flag of its own would mean
        // this command exiting non-zero and `tula exposure` after it exiting 0
        // about the same book.
      }
    }
    return {
      kind: 'output',
      output:
        `Pricing from ${provider.name}. ${priced} asset${priced === 1 ? '' : 's'} priced.\n` +
        '  Every figure is repriced from one source; nothing is mixed.',
    }
  }

  switch (sub) {
    case 'docs':
      return { kind: 'output', ...commands.priceDocs(provider) }
    case 'status':
      return { kind: 'output', ...commands.priceStatus(provider, active, Boolean(key)) }

    case 'connect':
      return provider.keyless
        ? {
            kind: 'output',
            output: `${provider.name} needs no key. Use it with:  ${typed(`${provider.id} use`)}`,
          }
        : { kind: 'connect-price', provider: provider.id }

    case 'use':
      if (active) {
        return { kind: 'output', output: `${provider.name} is already the active price source.` }
      }
      if (!provider.keyless && !key) return { kind: 'connect-price', provider: provider.id }
      return activate(key ? { apiKey: key } : undefined)

    case 'disconnect': {
      if (!active) {
        return {
          kind: 'output',
          output: `${provider.name} is not the active source, so nothing is stored for it.`,
        }
      }
      if (provider.id === DEFAULT_PROVIDER) {
        return {
          kind: 'output',
          output:
            `${provider.name} needs no key, so there is nothing to forget.\n` +
            '  It is the source tula falls back to; switch away by choosing another.',
        }
      }
      await secrets.putPriceSource(DEFAULT_PROVIDER)
      const { oracle } = buildOracle(DEFAULT_PROVIDER)
      await session.useOracle(oracle)
      return {
        kind: 'output',
        output: `Forgot the ${provider.name} key. Pricing from CoinGecko again.`,
      }
    }

    default:
      return { kind: 'output', output: `${typed(provider.id)} has no "${sub}".` }
  }
}

export async function dispatchCommand(
  session: Session,
  connectors: Map<string, Connector>,
  parsed: ParsedCommand,
  venues: VenueEntry[] = [],
  /** Named so `/update install` can say how far the download has got. */
  onProgress?: DownloadProgress,
): Promise<DispatchResult> {
  const { name, args } = parsed

  const provider = priceProvider(name)
  if (provider) return dispatchPrice(session, provider, args)

  const connector = connectors.get(name)
  if (connector) {
    const connected = venues.some((v) => v.id === name && v.connected)
    return dispatchVenue(session, connector, connected, args)
  }

  switch (name) {
    case 'positions':
      return { kind: 'output', ...(await commands.positions(session)) }
    case 'exposure':
      return { kind: 'output', ...(await commands.exposure(session)) }
    case 'breaks':
      return { kind: 'output', ...(await commands.breaks(session)) }
    case 'shock':
      return { kind: 'output', ...(await commands.shock(session, args)) }
    case 'venues':
      return { kind: 'output', ...(await commands.venues(session, connectors)) }

    case 'refresh': {
      const loaded = await session.refresh()
      // Counted from what is connected, not from what returned rows: a venue
      // holding nothing contributes no position, and a venue that failed
      // contributes at most a previous read, so a count off `positions` was
      // short of both — while sub-account labels like `kraken-margin` counted
      // twice.
      const venueCount = (await secrets.listVenues()).length
      const note = commands.incompleteNote(session)
      return {
        kind: 'output',
        // This is the command somebody runs to recover from a failure, so it is
        // the last one that may report success while a venue is still missing.
        output: `Refreshed ${plural(venueCount, 'venue')}, ${plural(loaded.positions.length, 'position')}.${note}`,
        note,
        // As every risk command counts it, price source included, or `tula
        // refresh && tula exposure` exits 0 and then 1 for one state.
        incomplete: commands.isIncomplete(session),
      }
    }

    case 'about':
      return { kind: 'output', ...(await commands.about(connectors)) }

    case 'update': {
      const { output, failed } = await update(args, onProgress)
      return failed ? { kind: 'output', output, usageError: true } : { kind: 'output', output }
    }

    case 'help': {
      const stored = await secrets.getPriceSource()
      const activeId = stored?.provider ?? DEFAULT_PROVIDER
      return {
        kind: 'output',
        output: helpText([...connectors.keys()], venues, priceEntries(activeId)),
      }
    }

    case 'forget': {
      const target = args[0]
      if (!target) return { kind: 'output', output: `Usage: ${typed('forget <venue>')}`, usageError: true }
      const stored = await secrets.listVenues()
      if (!stored.includes(target)) {
        return {
          kind: 'output',
          output: `Nothing stored for "${target}". Stored venues: ${stored.join(', ') || 'none'}`,
        }
      }
      // Counted before the delete, and named: forgetting a venue that held
      // three addresses is three deletions, and a line that says "its
      // credentials" reads as one.
      const held = await secrets.listCredentials(target)
      await secrets.remove(target)
      await session.refresh()
      return {
        kind: 'output',
        output:
          held.length > 1
            ? `Removed ${target}, and all ${held.length} of what it held: ${held.map(secrets.credentialLabel).join(', ')}.`
            : `Removed ${target}. Its credentials are gone from disk.`,
      }
    }

    case 'connect': {
      if (args[0] && connectors.has(args[0])) return { kind: 'connect', venue: args[0] }
      const gone = args[0] ? retired(args[0], forgetCommand(args[0])) : undefined
      const output =
        gone ?? `Pick a venue directly — type / and choose one. Available: ${[...connectors.keys()].join(', ')}`
      return { kind: 'output', output, note: output }
    }

    // Every group, vim's included and titled as such: this runs from the
    // command line as well, where there is no vim mode to ask about. The `?`
    // panel is the one that shows vim's rows only while vim is on.
    case 'keys':
      return { kind: 'output', output: keysText({ vim: true }) }

    case 'exit':
    case 'clear':
    case 'login':
    // Handed to `app.tsx`, the one caller `scripts/guard.sh` allows: see src/history/history.ts.
    case 'history':
    case 'vim':
      return { kind: 'ui', action: name }

    default: {
      // Before the near-miss guess: `/circle` is not a typo for anything, and
      // the reader typing it is the one person who has a key to deal with.
      const gone = retired(name, forgetCommand(name))
      if (gone) return { kind: 'output', output: gone }
      const guess = nearestCommand(name)
      return {
        kind: 'output',
        output: guess
          ? `Unknown command /${name}. Did you mean /${guess}?`
          : `Unknown command /${name}. Type / to see them all.`,
      }
    }
  }
}
