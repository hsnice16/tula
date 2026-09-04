import type { Connector } from '../connectors/types.js'
import * as secrets from '../secrets/store.js'
import * as commands from './commands.js'
import {
  buildOracle,
  DEFAULT_PROVIDER,
  PRICE_PROVIDERS,
  priceProvider,
  type PriceProvider,
} from '../prices/providers.js'
import {
  defaultSubcommand,
  helpText,
  nearestCommand,
  parseCommand,
  PRICE_SUBCOMMANDS,
  VENUE_SUBCOMMANDS,
  type ParsedCommand,
  type VenueEntry,
} from './registry.js'
import type { Session } from './session.js'

export type UiAction = 'exit' | 'clear' | 'login'

export type DispatchResult =
  | { kind: 'output'; output: string; incomplete?: boolean; usageError?: boolean }
  | { kind: 'ui'; action: UiAction }
  | { kind: 'connect'; venue: string }
  | { kind: 'connect-price'; provider: string }

export { parseCommand, type ParsedCommand }

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
    return { kind: 'output', output: `/${id} has no "${sub}". Try: ${available}`, usageError: true }
  }

  if (sub === 'connect') return { kind: 'connect', venue: id }
  if (sub === 'docs') return { kind: 'output', ...commands.venueDocs(connector) }

  if (!connected) {
    return {
      kind: 'output',
      output:
        `${connector.venue.name} is not connected yet.\n` +
        `  Connect it with:  /${id} connect\n` +
        (connector.help[0] ? `  ${connector.help[0].label}:  ${connector.help[0].url}` : ''),
    }
  }

  switch (sub) {
    case 'positions':
      return { kind: 'output', ...(await commands.positionsAt(session, id, connector.venue.kind)) }
    case 'breaks':
      return { kind: 'output', ...(await commands.breaksAt(session, id)) }
    case 'status':
      return { kind: 'output', ...(await commands.venueStatus(session, connector, connected)) }
    case 'disconnect': {
      await secrets.remove(id)
      await session.refresh()
      return {
        kind: 'output',
        output: `Forgot ${connector.venue.name}. Its credentials are gone from disk.`,
      }
    }
    default:
      return { kind: 'output', output: `/${id} has no "${sub}".` }
  }
}

/**
 * Where to go when a source will not answer. This named the default whatever
 * had happened, so a failed switch to CoinGecko told the reader to re-run the
 * command that had just failed, and failing away from CoinPaprika sent them
 * somewhere they had never been.
 */
export function wayBack(previous: string, failed: string): string {
  if (previous !== failed) return `Go back with:  /${previous} use`
  const others = PRICE_PROVIDERS.filter((p) => p.id !== failed && p.keyless)
  if (others.length === 0) return 'Every keyless source is unavailable; try again with /refresh.'
  return `Try another source:  ${others.map((p) => `/${p.id} use`).join('  ')}`
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
      output: `/${provider.id} has no "${sub}". Try: ${available}`,
      usageError: true,
    }
  }

  const activate = async (creds?: { apiKey: string }): Promise<DispatchResult> => {
    await secrets.putPriceSource(provider.id, creds?.apiKey)
    const { oracle } = buildOracle(provider.id, creds)
    const loaded = await session.useOracle(oracle)
    if (loaded.priceError) {
      return {
        kind: 'output',
        incomplete: true,
        output:
          `Switched to ${provider.name}, but it did not answer:\n  ${loaded.priceError}\n` +
          `  Quantities are still correct. ${wayBack(previous, provider.id)}`,
      }
    }
    const priced = loaded.prices.size
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
            output: `${provider.name} needs no key. Use it with:  /${provider.id} use`,
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
      return { kind: 'output', output: `/${provider.id} has no "${sub}".` }
  }
}

export async function dispatchCommand(
  session: Session,
  connectors: Map<string, Connector>,
  parsed: ParsedCommand,
  venues: VenueEntry[] = [],
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
      const venueCount = new Set(loaded.positions.map((p) => p.venue)).size
      return {
        kind: 'output',
        output: `Refreshed ${venueCount} venue(s), ${loaded.positions.length} position(s).`,
      }
    }

    case 'about':
      return { kind: 'output', ...(await commands.about(connectors)) }

    case 'help': {
      const stored = await secrets.getPriceSource()
      const activeId = stored?.provider ?? DEFAULT_PROVIDER
      const prices = PRICE_PROVIDERS.map((p) => ({
        id: p.id,
        active: p.id === activeId,
        detail: p.id === activeId ? `${p.name} — pricing everything` : p.summary,
      }))
      return { kind: 'output', output: helpText([...connectors.keys()], venues, prices) }
    }

    case 'forget': {
      const target = args[0]
      if (!target) return { kind: 'output', output: 'Usage: /forget <venue>', usageError: true }
      const stored = await secrets.listVenues()
      if (!stored.includes(target)) {
        return {
          kind: 'output',
          output: `Nothing stored for "${target}". Stored venues: ${stored.join(', ') || 'none'}`,
        }
      }
      await secrets.remove(target)
      await session.refresh()
      return { kind: 'output', output: `Removed ${target}. Its credentials are gone from disk.` }
    }

    case 'connect':
      return args[0] && connectors.has(args[0])
        ? { kind: 'connect', venue: args[0] }
        : {
            kind: 'output',
            output: `Pick a venue directly — type / and choose one. Available: ${[...connectors.keys()].join(', ')}`,
          }

    case 'exit':
    case 'clear':
    case 'login':
      return { kind: 'ui', action: name }

    default: {
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
