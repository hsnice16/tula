import { PRICE_PROVIDERS } from '../prices/providers.js'

export type CommandGroup = 'risk' | 'venues' | 'prices' | 'session'

/** Section order in the menu and in help. The book comes first: it is the product. */
export const GROUP_ORDER: readonly CommandGroup[] = ['risk', 'venues', 'prices', 'session']

export const GROUP_LABELS: Readonly<Record<CommandGroup, string>> = {
  risk: 'your book',
  venues: 'venues',
  prices: 'price source',
  session: 'session',
}

export interface SlashCommand {
  name: string
  args?: string
  summary: string
  group?: CommandGroup
  /** Handled by the UI rather than the query layer. */
  ui?: boolean
  /** Runnable, but kept out of the menu. */
  hidden?: boolean
  /** A connected venue rather than a fixed command. */
  venue?: boolean
  /** A price source rather than a fixed command. */
  price?: boolean
}

export interface VenueSubcommand {
  name: string
  summary: string
  /** Hidden until the venue has credentials stored. */
  needsConnection: boolean
}

/** Everything you can do to one venue, reached as `/<venue> <sub>`. */
export const VENUE_SUBCOMMANDS: readonly VenueSubcommand[] = [
  { name: 'connect', summary: 'Add or replace this venue’s read-only key', needsConnection: false },
  { name: 'positions', summary: 'Positions held here', needsConnection: true },
  { name: 'breaks', summary: 'What can be liquidated here', needsConnection: true },
  { name: 'status', summary: 'Freshness, key scope, last error', needsConnection: true },
  { name: 'docs', summary: 'Official links for this venue', needsConnection: false },
  { name: 'disconnect', summary: 'Forget this venue’s credentials', needsConnection: true },
]

/** Everything you can do to a price source, reached as `/<source> <sub>`. */
export const PRICE_SUBCOMMANDS: readonly VenueSubcommand[] = [
  { name: 'use', summary: 'Price every figure from this source', needsConnection: false },
  { name: 'connect', summary: 'Add or replace this source’s API key', needsConnection: false },
  { name: 'status', summary: 'Whether this is the active source, and what it needs', needsConnection: false },
  { name: 'docs', summary: 'Official links for this source', needsConnection: false },
  { name: 'disconnect', summary: 'Forget this source’s key and fall back to CoinGecko', needsConnection: true },
]

export function matchPriceSubcommands(fragment: string, connected: boolean): VenueSubcommand[] {
  const needle = fragment.toLowerCase()
  return PRICE_SUBCOMMANDS.filter(
    (c) => (connected || !c.needsConnection) && c.name.startsWith(needle),
  )
}

export function matchVenueSubcommands(fragment: string, connected: boolean): VenueSubcommand[] {
  const needle = fragment.toLowerCase()
  return VENUE_SUBCOMMANDS.filter(
    (c) => (connected || !c.needsConnection) && c.name.startsWith(needle),
  )
}

/** The sub to run when the user names a venue and nothing else. */
export function defaultSubcommand(connected: boolean): string {
  return connected ? 'status' : 'connect'
}

export interface PriceEntry {
  id: string
  /** "active", "not connected", or why it cannot be used. */
  detail: string
  active: boolean
}

export interface VenueEntry {
  id: string
  /** Position count and freshness, the failure, or "not connected". */
  detail: string
  connected: boolean
}

/**
 * One source of truth for the command surface: the menu, the help text, the
 * one-shot CLI and the dispatcher all read this. Two lists would drift.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'breaks', group: 'risk', summary: 'What gets liquidated first, and how far away that is' },
  { name: 'exposure', group: 'risk', summary: 'Net exposure per asset, across every venue' },
  { name: 'positions', group: 'risk', summary: 'Every position, as each venue reports it' },
  { name: 'shock', group: 'risk', args: '<asset> <percent>', summary: 'Reprice everything and see what survives' },

  { name: 'about', group: 'session', summary: 'What tula is, what it will not do, and where your keys live' },
  { name: 'clear', group: 'session', summary: 'Clear the screen', ui: true },
  { name: 'exit', group: 'session', summary: 'Leave tula', ui: true },
  { name: 'help', group: 'session', summary: 'Show this list', ui: true },
  { name: 'login', group: 'session', summary: 'Set or replace your Anthropic API key', ui: true },
  { name: 'refresh', group: 'session', summary: 'Refetch from every venue now' },

  // Runnable, out of the menu. `/venues` is what the menu already shows, and
  // `/forget` is the recovery path session.ts names when a stored venue is not
  // in this build — an error that points at a command it must still be able to run.
  { name: 'connect', args: '<venue>', summary: 'Connect a venue with a read-only key', hidden: true },
  { name: 'venues', summary: 'Connected venues, freshness, failures', hidden: true },
  { name: 'forget', args: '<venue>', summary: 'Remove a stored venue', hidden: true },
]

const ALIASES: Readonly<Record<string, string>> = {
  ls: 'positions',
  pos: 'positions',
  net: 'exposure',
  exp: 'exposure',
  risk: 'breaks',
  quit: 'exit',
  q: 'exit',
}

export interface ParsedCommand {
  name: string
  args: string[]
  known: boolean
}

/** Null when the line is not a command at all — that goes to the model. */
export function parseCommand(line: string, venueIds: string[] = []): ParsedCommand | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('/')) return null
  const [head = '', ...args] = trimmed.slice(1).split(/\s+/).filter(Boolean)
  const name = ALIASES[head.toLowerCase()] ?? head.toLowerCase()
  const known =
    SLASH_COMMANDS.some((c) => c.name === name) ||
    venueIds.some((id) => id.toLowerCase() === name) ||
    PRICE_PROVIDERS.some((p) => p.id === name)
  return { name, args, known }
}

/**
 * The command list as the user sees it: the fixed commands plus one entry per
 * connected venue. The venues carry their own status, which is why there is no
 * `/venues` command in the menu — the menu is the overview.
 */
export function buildCommands(
  venues: VenueEntry[] = [],
  prices: PriceEntry[] = [],
): SlashCommand[] {
  const dynamic: SlashCommand[] = [
    ...venues.map((v) => ({ name: v.id, summary: v.detail, group: 'venues' as const, venue: true })),
    ...prices.map((p) => ({ name: p.id, summary: p.detail, group: 'prices' as const, price: true })),
  ]
  const all = [...SLASH_COMMANDS.filter((c) => !c.hidden), ...dynamic]
  // Sections in a fixed order, names alphabetical inside each: the only ordering
  // a user can predict without having learned the list first.
  return GROUP_ORDER.flatMap((group) =>
    all.filter((c) => c.group === group).sort((a, b) => a.name.localeCompare(b.name)),
  )
}

/** Commands whose first characters match, for the menu and for completion. */
export function matchCommands(
  fragment: string,
  venues: VenueEntry[] = [],
  prices: PriceEntry[] = [],
): SlashCommand[] {
  const needle = fragment.toLowerCase()
  return buildCommands(venues, prices).filter((c) => c.name.toLowerCase().startsWith(needle))
}

/** Levenshtein, capped: only used to suggest one near miss. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost)
    }
  }
  return rows[a.length]![b.length]!
}

export function nearestCommand(name: string): string | null {
  let best: string | null = null
  let bestScore = 3
  for (const candidate of SLASH_COMMANDS) {
    const score = distance(name, candidate.name)
    if (score < bestScore) {
      bestScore = score
      best = candidate.name
    }
  }
  return best
}

export function helpText(
  venues: string[],
  connected: VenueEntry[] = [],
  prices: PriceEntry[] = [],
): string {
  const all = buildCommands(connected, prices)
  const label = (c: SlashCommand) => `/${c.name} ${c.args ?? ''}`.trimEnd()
  const width = Math.max(...all.map((c) => label(c).length))

  const sections = GROUP_ORDER.flatMap((group) => {
    const rows = all.filter((c) => c.group === group)
    if (rows.length === 0) return []
    return [
      `${GROUP_LABELS[group]}`,
      ...rows.map((c) => `  ${label(c).padEnd(width)}  ${c.summary}`),
      '',
    ]
  })

  return [
    'Type / for commands, or just ask a question in plain English.',
    '',
    ...sections,
    `Venues in this build: ${venues.join(', ')}`,
    'Every number carries when it was true. A venue that fails is named, never hidden.',
  ].join('\n')
}

export interface PaletteEntry {
  /** The whole command as it would be typed, minus the leading slash. */
  path: string
  args?: string
  summary: string
  /** Section label. Shown as a heading while browsing, dropped once ranked. */
  group: string
  /** Nothing left to supply, so it can be run outright rather than completed. */
  runnable: boolean
  /** Kept out of the menu, and out of the palette until something is typed. */
  hidden?: boolean
}

/**
 * The command surface flattened: every top-level command, plus every
 * `/<venue> <sub>` and `/<source> <sub>` reachable right now. The `/` menu
 * walks this two steps at a time, which is the wrong shape for someone who
 * knows the verb but not which venue it hangs off.
 */
export function buildPalette(
  venues: VenueEntry[] = [],
  prices: PriceEntry[] = [],
): PaletteEntry[] {
  const entries: PaletteEntry[] = buildCommands(venues, prices).map((c) => ({
    path: c.name,
    ...(c.args ? { args: c.args } : {}),
    summary: c.summary,
    group: GROUP_LABELS[c.group ?? 'session'],
    // A bare venue or price source runs its default sub, so it needs no typing.
    runnable: c.args === undefined,
  }))

  for (const venue of venues) {
    for (const sub of matchVenueSubcommands('', venue.connected)) {
      entries.push({
        path: `${venue.id} ${sub.name}`,
        summary: sub.summary,
        group: GROUP_LABELS.venues,
        runnable: true,
      })
    }
  }
  for (const price of prices) {
    for (const sub of matchPriceSubcommands('', price.active)) {
      entries.push({
        path: `${price.id} ${sub.name}`,
        summary: sub.summary,
        group: GROUP_LABELS.prices,
        runnable: true,
      })
    }
  }
  for (const c of SLASH_COMMANDS.filter((c) => c.hidden)) {
    entries.push({
      path: c.name,
      ...(c.args ? { args: c.args } : {}),
      summary: c.summary,
      group: GROUP_LABELS[c.group ?? 'session'],
      runnable: c.args === undefined,
      hidden: true,
    })
  }
  return entries
}

/**
 * Subsequence match, scored so the ranking is explainable rather than clever:
 * a hit at a word boundary and a run of adjacent hits both beat the same
 * characters scattered through the string. Null when one is missing entirely.
 */
function fuzzyScore(needle: string, hay: string): number | null {
  let total = 0
  let from = 0
  let run = 0
  for (const ch of needle) {
    const at = hay.indexOf(ch, from)
    if (at === -1) return null
    run = at === from && from > 0 ? run + 1 : 0
    const boundary = at === 0 || hay[at - 1] === ' ' || hay[at - 1] === '-'
    total += 10 + run * 4 + (boundary ? 6 : 0) - Math.min(at - from, 8)
    from = at + 1
  }
  return total
}

/**
 * Ranked matches for the palette. The name is matched loosely and the summary
 * only literally, and any name hit outranks every summary hit: someone typing
 * `pos` means `/positions`, not each command whose description says "position".
 */
export function matchPalette(query: string, entries: PaletteEntry[]): PaletteEntry[] {
  const needle = query.trim().toLowerCase().replace(/^\/+/, '')
  if (needle === '') return entries.filter((e) => !e.hidden)

  const ranked: { entry: PaletteEntry; rank: number }[] = []
  for (const entry of entries) {
    const path = fuzzyScore(needle, entry.path.toLowerCase())
    if (path !== null) ranked.push({ entry, rank: path + 1_000 })
    else if (entry.summary.toLowerCase().includes(needle)) ranked.push({ entry, rank: 0 })
  }
  // Stable, so equal ranks keep the order buildPalette put them in — grouped
  // and alphabetical, the one order a user can predict without learning it.
  return ranked.sort((a, b) => b.rank - a.rank).map((r) => r.entry)
}
