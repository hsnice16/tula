import { isCli, typed } from '../core/surface.js'
import { PRICE_PROVIDERS } from '../prices/providers.js'

/** The delete, spelled for the surface. What `retired()` in `src/connectors/types.ts` is handed. */
export function forgetCommand(venueId: string): string {
  return typed(`forget ${venueId}`)
}

/**
 * How somebody with no credential is sent to sign in. Not `typed('login')`:
 * `tula login` is a command that exists only to answer that it is a shell
 * screen, so naming it on the command line is a remedy that sends the reader
 * back for a second one. The shell is the way out there; `ant auth login` is a
 * real command on either surface.
 */
export function signInCommand(): string {
  return isCli()
    ? 'run tula, then /login — or: ant auth login'
    : '/login, or: ant auth login'
}

/** How somebody with no venue connected is sent to choose one. */
export function pickVenue(): string {
  return isCli() ? 'Connect one with:  tula connect <venue>' : 'Type / and pick one.'
}

export type CommandGroup = 'risk' | 'venues' | 'prices' | 'session'

/** Section order in the menu and in help. The book comes first: it is the product. */
export const GROUP_ORDER: readonly CommandGroup[] = ['risk', 'venues', 'prices', 'session']

export const GROUP_LABELS: Readonly<Record<CommandGroup, string>> = {
  risk: 'your book',
  venues: 'venues',
  prices: 'price source',
  session: 'session',
}

/** One thing that can be typed where an argument goes, and what it is. */
export interface Candidate {
  name: string
  summary: string
}

/**
 * Where one argument's candidates come from, declared beside the command so
 * the list and what the command takes are one edit apart — fish's `complete -a`
 * per subcommand, prompt_toolkit's `NestedCompleter`.
 */
export type ArgumentSource =
  | { kind: 'venues' }
  | { kind: 'stored-venues' }
  | { kind: 'assets' }
  | { kind: 'accounts' }
  | { kind: 'words'; words: readonly Candidate[] }
  /** Nothing to pick from, only a shape to type — a percentage. */
  | { kind: 'free'; hint: string }

export interface SlashCommand {
  name: string
  args?: string
  /** One per word of `args`, in order. */
  arguments?: readonly ArgumentSource[]
  /** The arguments come round again: `/shock ETH -20 BTC -10`. */
  repeats?: boolean
  summary: string
  group?: CommandGroup
  /** Runnable, but kept out of the menu. */
  hidden?: boolean
  /** A connected venue rather than a fixed command. */
  venue?: boolean
  /** A price source rather than a fixed command. */
  price?: boolean
  /** Means something only inside the shell, so `tula <name>` refuses it. */
  shellOnly?: boolean
}

export interface VenueSubcommand {
  name: string
  summary: string
  /** Hidden until the venue has credentials stored. */
  needsConnection: boolean
  arguments?: readonly ArgumentSource[]
}

/** Everything you can do to one venue, reached as `/<venue> <sub>`. */
export const VENUE_SUBCOMMANDS: readonly VenueSubcommand[] = [
  { name: 'connect', summary: 'Add or replace this venue’s read-only key', needsConnection: false },
  { name: 'positions', summary: 'Positions held here', needsConnection: true },
  { name: 'breaks', summary: 'What can be liquidated here', needsConnection: true },
  { name: 'status', summary: 'Freshness, key scope, last error', needsConnection: true },
  { name: 'docs', summary: 'Official links for this venue', needsConnection: false },
  {
    name: 'disconnect',
    summary: 'Forget this venue’s credentials',
    needsConnection: true,
    arguments: [{ kind: 'accounts' }],
  },
]

export interface PriceSubcommand extends VenueSubcommand {
  /** A keyless source has nothing to paste and nothing to forget. */
  needsKey: boolean
}

/**
 * Everything you can do to a price source, reached as `/<source> <sub>`. Only
 * the active source has a key stored, so `needsConnection` here is that.
 */
export const PRICE_SUBCOMMANDS: readonly PriceSubcommand[] = [
  { name: 'use', summary: 'Price every figure from this source', needsConnection: false, needsKey: false },
  { name: 'connect', summary: 'Add or replace this source’s API key', needsConnection: false, needsKey: true },
  { name: 'status', summary: 'Whether this is the active source, and what it needs', needsConnection: false, needsKey: false },
  { name: 'docs', summary: 'Official links for this source', needsConnection: false, needsKey: false },
  { name: 'disconnect', summary: 'Forget this source’s key and fall back to CoinGecko', needsConnection: true, needsKey: true },
]

export function matchPriceSubcommands(
  fragment: string,
  price: { active: boolean; keyless: boolean },
): PriceSubcommand[] {
  const needle = fragment.toLowerCase()
  return PRICE_SUBCOMMANDS.filter(
    (c) =>
      (price.active || !c.needsConnection) &&
      (!price.keyless || !c.needsKey) &&
      c.name.startsWith(needle),
  )
}

/**
 * A venue read from a public address holds no credential, so offering it
 * "add or replace this venue's read-only key" is
 * the sentence `src/index.ts` already suppresses at the prompt itself — and the
 * one a reader is least able to shrug off, since a tool that asks a wallet for
 * a key is the shape of a phishing page.
 */
const ADDRESS_ONLY_SUMMARY: Readonly<Record<string, string>> = {
  connect: 'Add or replace this venue’s public address',
  disconnect: 'Forget this venue’s address',
  status: 'Freshness and last error — there is no key to scope',
}

export function matchVenueSubcommands(
  fragment: string,
  connected: boolean,
  addressOnly = false,
): VenueSubcommand[] {
  const needle = fragment.toLowerCase()
  return VENUE_SUBCOMMANDS.filter(
    (c) => (connected || !c.needsConnection) && c.name.startsWith(needle),
  ).map((c) => {
    const summary = addressOnly ? ADDRESS_ONLY_SUMMARY[c.name] : undefined
    return summary ? { ...c, summary } : c
  })
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
  keyless: boolean
}

/** The price sources as the menu and the help text show them. */
export function priceEntries(activeId: string): PriceEntry[] {
  return PRICE_PROVIDERS.map((p) => ({
    id: p.id,
    active: p.id === activeId,
    keyless: p.keyless,
    detail: p.id === activeId ? `${p.name} — pricing everything` : p.summary,
  }))
}

export interface VenueEntry {
  id: string
  /** Position count and freshness, the failure, or "not connected". */
  detail: string
  connected: boolean
  /** Read from a public address, so nothing about it is a key. */
  addressOnly?: boolean
}

/**
 * One source of truth for the command surface: the menu, the help text, the
 * one-shot CLI and the dispatcher all read this. Two lists would drift.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'breaks', group: 'risk', summary: 'What gets liquidated first, and how far away that is' },
  { name: 'exposure', group: 'risk', summary: 'Net exposure per asset, across every venue' },
  { name: 'positions', group: 'risk', summary: 'Every position, as each venue reports it' },
  {
    name: 'shock',
    group: 'risk',
    args: '<asset> <percent>',
    arguments: [{ kind: 'assets' }, { kind: 'free', hint: 'a move in percent, e.g. -20 — another asset may follow it' }],
    repeats: true,
    summary: 'Reprice everything and see what survives',
  },

  { name: 'about', group: 'session', summary: 'What tula is, what it will not do, and where your keys live' },
  { name: 'clear', group: 'session', summary: 'Clear the screen', shellOnly: true },
  { name: 'exit', group: 'session', summary: 'Leave tula', shellOnly: true },
  { name: 'help', group: 'session', summary: 'Show this list' },
  { name: 'keys', group: 'session', summary: 'Every key the shell answers to' },
  {
    name: 'history',
    group: 'session',
    args: '[clear]',
    arguments: [{ kind: 'words', words: [{ name: 'clear', summary: 'Empty the history file' }] }],
    summary: 'Where what you typed is kept; clear empties it',
    shellOnly: true,
  },
  { name: 'login', group: 'session', summary: 'See or change how you sign in to Anthropic', shellOnly: true },
  { name: 'refresh', group: 'session', summary: 'Refetch from every venue now' },
  { name: 'vim', group: 'session', summary: 'Vim editing on the input line, on or off — it stays set', shellOnly: true },
  {
    name: 'update',
    group: 'session',
    args: '[install]',
    arguments: [{ kind: 'words', words: [{ name: 'install', summary: 'Download the newer release and switch to it' }] }],
    summary: 'Check for a newer release, and switch to it',
  },

  // Runnable, out of the menu. `/venues` is what the menu already shows, and
  // `/forget` is the recovery path session.ts names when a stored venue is not
  // in this build — an error that points at a command it must still be able to run.
  {
    name: 'connect',
    args: '<venue>',
    arguments: [{ kind: 'venues' }],
    summary: 'Connect a venue — a public address, or a read-only key',
    hidden: true,
  },
  { name: 'venues', summary: 'Connected venues, freshness, failures', hidden: true },
  {
    name: 'forget',
    args: '<venue>',
    arguments: [{ kind: 'stored-venues' }],
    summary: 'Remove a stored venue',
    hidden: true,
  },
]

/** What the candidates are read from. Every field is already in hand: nothing here loads. */
export interface CandidateContext {
  /** Every venue in the build, as the menu lists them. */
  venues: readonly VenueEntry[]
  /** Whatever the store holds a credential for, a venue this build dropped included. */
  stored: readonly Candidate[]
  /** The assets of the loaded book, or null before a load. */
  assets: readonly Candidate[] | null
  /** The entries a venue holds, named the way a command takes them back; null until read. */
  accounts: (venue: string) => readonly Candidate[] | null
}

export interface ArgumentList {
  /** The line up to the word being completed; a chosen candidate goes after it. */
  prefix: string
  /** The command and the argument the list is for, as `/shock <asset>`. */
  heading: string
  candidates: Candidate[]
  /** Why nothing is offered, where nothing is. */
  empty?: string
}

/**
 * The candidates for the argument the cursor is in, filtered by what has been
 * typed of it. Null where there is no list to show: before the command's first
 * space, past its last argument, or where nothing offered starts with what is
 * typed — which is when Enter sends the line as it stands.
 */
export function argumentList(line: string, context: CandidateContext): ArgumentList | null {
  if (!line.startsWith('/')) return null
  const fragment = /\S*$/.exec(line)?.[0] ?? ''
  const prefix = line.slice(0, line.length - fragment.length)
  const words = prefix.slice(1).split(/\s+/).filter(Boolean)
  const head = words[0]?.toLowerCase()
  if (!head || !/\s$/.test(prefix)) return null

  let source: ArgumentSource | undefined
  let heading: string
  const command = SLASH_COMMANDS.find((c) => c.name === (ALIASES[head] ?? head))
  if (command?.arguments) {
    const at = words.length - 1
    const index = command.repeats ? at % command.arguments.length : at
    source = command.arguments[index]
    heading = `/${command.name} ${command.args?.split(' ')[index] ?? ''}`.trimEnd()
  } else {
    const venue = context.venues.find((v) => v.id === head)
    const sub = VENUE_SUBCOMMANDS.find((s) => s.name === words[1]?.toLowerCase())
    if (!venue?.connected || !sub?.arguments) return null
    source = sub.arguments[words.length - 2]
    heading = `/${venue.id} ${sub.name} <name>`
  }
  if (!source) return null

  const matching = (all: readonly Candidate[]): ArgumentList | null => {
    const needle = fragment.toLowerCase()
    const candidates = all.filter((c) => c.name.toLowerCase().startsWith(needle))
    return candidates.length === 0 ? null : { prefix, heading, candidates }
  }
  const offered = (all: readonly Candidate[], empty: string): ArgumentList | null =>
    all.length === 0 ? { prefix, heading, candidates: [], empty } : matching(all)

  switch (source.kind) {
    case 'free':
      return { prefix, heading, candidates: [], empty: source.hint }
    case 'words':
      return matching(source.words)
    case 'venues':
      return offered(
        context.venues.map((v) => ({ name: v.id, summary: v.detail })),
        'no venue is in this build',
      )
    case 'stored-venues':
      return offered(context.stored, 'nothing is stored — type / and pick a venue to connect one')
    case 'assets':
      // Offered off a book already read and never by reading one: a space
      // typed after `/shock` is not a request to call every venue.
      if (context.assets === null) {
        return {
          prefix,
          heading,
          candidates: [],
          empty:
            context.stored.length === 0
              ? 'nothing is connected, so there is no asset to shock — type / and pick a venue'
              : 'nothing is read yet — /refresh reads the book, and its assets are listed here',
        }
      }
      return offered(context.assets, 'the book holds no asset to shock')
    case 'accounts': {
      // One entry needs no name to say which: `/<venue> disconnect` alone takes it.
      const held = context.accounts(head)
      return held && held.length > 1 ? matching(held) : null
    }
  }
}

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
 * Whether a line already tells the reader what to type. The test used to be
 * whether the text held a slash, and a venue's own error carries one whenever
 * it quotes a URL — a Cloudflare 503 names `/cdn-cgi/...` in its body — so a
 * venue that named a problem and no way out silenced the remedy line meant to
 * supply one. What makes a line a remedy is that it names a command tula has,
 * which is a fact about tula rather than about somebody else's prose.
 */
export function namesCommand(text: string, venueIds: string[] = []): boolean {
  for (const match of text.matchAll(/(?:^|[\s(])(?:\/|tula\s+)([a-z][a-z0-9-]*)/gi)) {
    const name = match[1]
    if (name && parseCommand(`/${name}`, venueIds)?.known) return true
  }
  return false
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

/**
 * The menu list: the commands, with a connected venue's subcommands opened out
 * under it, in the order and wording ctrl+s already shows them. An unconnected
 * venue stays one row — the two subs it has are `connect`, which its own row
 * runs, and `docs`, and every venue in the build opened out for those is a list
 * nobody can read down.
 */
export function menuCommands(
  venues: VenueEntry[] = [],
  prices: PriceEntry[] = [],
): SlashCommand[] {
  return buildCommands(venues, prices).flatMap((c) => {
    const venue = c.venue ? venues.find((v) => v.id === c.name) : undefined
    if (!venue?.connected) return [c]
    return [
      c,
      ...matchVenueSubcommands('', true, venue.addressOnly ?? false).map((sub) => ({
        name: `${c.name} ${sub.name}`,
        summary: sub.summary,
        ...(c.group ? { group: c.group } : {}),
      })),
    ]
  })
}

/** Commands whose first characters match, for the menu and for completion. */
export function matchCommands(
  fragment: string,
  venues: VenueEntry[] = [],
  prices: PriceEntry[] = [],
): SlashCommand[] {
  const needle = fragment.toLowerCase()
  return menuCommands(venues, prices).filter((c) => c.name.toLowerCase().startsWith(needle))
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
  // `tula clear` refuses to run, so help on the command line names those
  // commands as the shell spells them rather than listing them as runnable.
  const all = buildCommands(connected, prices).filter((c) => !(isCli() && c.shellOnly))
  const shellOnly = SLASH_COMMANDS.filter((c) => c.shellOnly).map((c) => `/${c.name}`)
  const label = (c: SlashCommand) => `${typed(c.name)} ${c.args ?? ''}`.trimEnd()
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
    isCli()
      ? 'Run any of these as shown. `tula` on its own opens the shell, where the same\ncommands take a slash and anything without one is a question in plain English.'
      : 'Type / for commands, or just ask a question in plain English.',
    '',
    ...sections,
    ...(isCli() ? [`Only inside the shell: ${shellOnly.join(', ')}`, ''] : []),
    `Venues in this build: ${venues.join(', ')}`,
    'Every number carries when it was true. A venue that fails is named, never hidden.',
    isCli()
      ? 'Every key the shell answers to: tula keys — or ? on an empty line inside it.'
      : 'Every key the shell answers to: ? on an empty line, or /keys.',
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
  // Each subcommand sits under the venue or source it hangs off, rather than in
  // a run of its own after every top-level command. Sections have to stay
  // contiguous: the palette opens a heading wherever the group changes, so a
  // group reached twice is drawn as two identical headings.
  const entries: PaletteEntry[] = buildCommands(venues, prices).flatMap((c) => {
    const group = GROUP_LABELS[c.group ?? 'session']
    const venue = c.venue ? venues.find((v) => v.id === c.name) : undefined
    const price = c.price ? prices.find((p) => p.id === c.name) : undefined
    const subs = venue
      ? matchVenueSubcommands('', venue.connected, venue.addressOnly ?? false)
      : price
        ? matchPriceSubcommands('', price)
        : []
    return [
      {
        path: c.name,
        ...(c.args ? { args: c.args } : {}),
        summary: c.summary,
        group,
        // A bare venue or price source runs its default sub, so it needs no typing.
        runnable: c.args === undefined,
      },
      ...subs.map((sub) => ({
        path: `${c.name} ${sub.name}`,
        summary: sub.summary,
        group,
        runnable: true,
      })),
    ]
  })
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
