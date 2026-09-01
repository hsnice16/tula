import { Box, Static, Text, useApp, useInput, useStdout } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Agent, hasAmbientCredentials } from '../agent/agent.js'
import { belongsToVenue } from '../cli/commands.js'
import { riskEngineFor } from '../cli/engine-adapter.js'
import {
  buildPalette,
  GROUP_LABELS,
  matchCommands,
  matchPalette,
  matchPriceSubcommands,
  matchVenueSubcommands,
  parseCommand,
  type PaletteEntry,
  type PriceEntry,
  type VenueEntry,
} from '../cli/registry.js'
import type { Session } from '../cli/session.js'
import { dispatchCommand } from '../cli/shell.js'
import type { Connector } from '../connectors/types.js'
import { TulaError } from '../core/errors.js'
import * as secrets from '../secrets/store.js'
import { APP_VERSION } from '../version.js'
import { ConnectFlow } from './ConnectFlow.js'
import { connectable, type Connectable, type ConnectorCredentials } from '../connectors/types.js'
import {
  asConnectable,
  buildOracle,
  DEFAULT_PROVIDER,
  PRICE_PROVIDERS,
  priceProvider,
} from '../prices/providers.js'
import { freshness, holdings } from '../core/format.js'
import { typed } from './keys.js'
import { Onboarding } from './Onboarding.js'
import { Palette } from './Palette.js'
import { clearForRedraw } from './resize.js'
import { SlashMenu, type MenuItem } from './SlashMenu.js'
import { InputLine } from './TextInput.js'
import { theme } from './theme.js'
import { wrapLines } from './wrap.js'

type EntryKind = 'prompt' | 'output' | 'answer' | 'error' | 'notice'

interface Entry {
  id: number
  kind: EntryKind
  text: string
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Rows an entry gets in the transcript before the rest is collapsed to a count.
 * A 176-position book is a screenful per answer, and the question above it
 * scrolls away before it can be read alongside what it returned.
 */
const PREVIEW_ROWS = 12

/** Short enough to feel live under a drag, long enough to coalesce its burst. */
const REDRAW_SETTLE_MS = 50

/** Drawn at, and subtracted from, the width an output block wraps against. */
const OUTPUT_INDENT = 3

/** What of an entry the transcript shows, and how much it is holding back. */
function preview(text: string, width: number): { text: string; hidden: number } {
  const rows = wrapLines(text, width)
  if (rows.length <= PREVIEW_ROWS) return { text, hidden: 0 }
  return { text: rows.slice(0, PREVIEW_ROWS).join('\n'), hidden: rows.length - PREVIEW_ROWS }
}

/**
 * What the model is doing, in the user's terms. A raw `get_positions` names an
 * internal function at somebody who asked a question about their money, and
 * says nothing about whether waiting is worth it.
 */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  get_net_exposure: 'netting your exposure',
  get_positions: 'reading your positions',
  what_breaks_first: 'ranking what breaks first',
  run_scenario: 'repricing the book',
  get_venue_status: 'checking every venue',
}

function Line({ kind, text }: { kind: EntryKind; text: string }) {
  if (kind === 'prompt') return <Text color={theme.accent}>{text}</Text>
  if (kind === 'error') return <Text color={theme.danger}>{text}</Text>
  if (kind === 'notice') return <Text color={theme.notice}>{text}</Text>
  return <Text>{text}</Text>
}

function Output({
  kind,
  text,
  width,
  expanded,
}: {
  kind: EntryKind
  text: string
  width: number
  expanded: boolean
}) {
  const { text: shown, hidden } = expanded ? { text, hidden: 0 } : preview(text, width)
  return (
    <Box marginBottom={1} paddingLeft={OUTPUT_INDENT} flexDirection="column">
      <Line kind={kind} text={shown} />
      {hidden > 0 && (
        // The way out belongs where the dead end is, not in a help screen.
        <Text dimColor>{`… ${hidden} more line${hidden === 1 ? '' : 's'} · ctrl+o`}</Text>
      )}
    </Box>
  )
}

type Menu = { items: MenuItem[]; prefix: string; heading?: string } & (
  | { level: 'top' }
  | { level: 'venue'; venue: string; heading: string }
) & {
  /** Rows the unfiltered menu would need. Fixing the block at this height keeps
   *  it from resizing as you type without reserving space it can never use. */
  total: number
}

interface Props {
  session: Session
  connectors: Map<string, Connector>
  initialApiKey: string | undefined
  initialVenues: string[]
}

export function App({ session, connectors, initialApiKey, initialVenues }: Props) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  // Static children sit outside the layout flow, so a percentage width has
  // nothing to resolve against; the block has to be told the real column count.
  // Held as state because a modal is sized to the viewport, and Ink re-renders
  // its own tree on resize without React ever reading the new dimensions.
  const [viewport, setViewport] = useState(() => ({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  }))
  const { columns, rows } = viewport
  // Only for arithmetic we do ourselves — what a preview wraps at, and the
  // count of what it holds back. The frame's own inset is `paddingRight` on the
  // root, never a width in cells: Ink repaints on the resize event with the tree
  // it already holds, so a width measured a moment ago lands in a terminal that
  // is already narrower, while a padding is relative and Yoga re-derives it on
  // that same repaint. Rows that wrap regardless are resize.ts's problem.
  const frameWidth = Math.max(20, columns - 1)
  // Measured, not chosen: "22 more lines" is only true if it counts the rows the
  // block would really take, and Ink wraps it at the width the indent leaves.
  const bodyWidth = Math.max(20, frameWidth - OUTPUT_INDENT)

  const [agent, setAgent] = useState<Agent | null>(() =>
    // An `ant auth login` profile is a credential too: gating on a key string
    // alone hides the agent from a user who is already signed in.
    initialApiKey || hasAmbientCredentials()
      ? new Agent(riskEngineFor(session), initialApiKey ? { apiKey: initialApiKey } : {})
      : null,
  )
  const [onboarding, setOnboarding] = useState(initialApiKey === undefined)
  const [connecting, setConnecting] = useState<Connectable | null>(null)
  // Set only while a price source is being keyed, so onDone knows to activate it.
  const [pendingPrice, setPendingPrice] = useState<string | null>(null)
  const [activePrice, setActivePrice] = useState<string>(DEFAULT_PROVIDER)
  const [connected, setConnected] = useState<string[]>(initialVenues)

  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState('')
  const [streaming, setStreaming] = useState('')
  const [frame, setFrame] = useState(0)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuDismissed, setMenuDismissed] = useState(false)
  const [palette, setPalette] = useState<{ query: string; index: number } | null>(null)
  // Whole-transcript rather than per-entry, and it outlives the entry it was
  // turned on for: after reading "18 more lines" you usually want the answer
  // above it whole too, and the next one as well.
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const historyIndex = useRef(-1)
  const nextId = useRef(0)

  const push = useCallback((kind: EntryKind, text: string) => {
    setEntries((prev) => [...prev, { id: nextId.current++, kind, text }])
  }, [])

  const clearScreen = useCallback(() => {
    setEntries([])
  }, [])

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setFrame((f) => f + 1), 80)
    return () => clearInterval(timer)
  }, [busy])

  // The transcript is <Static>: Ink writes it once and never revisits it, so the
  // screen a width change has to redraw (see guardResize) comes back without it.
  // Remounting <Static> resets the index it renders from and the whole
  // transcript is written again, at the width it is being read at.
  const [generation, setGeneration] = useState(0)
  // The viewport is not debounced: every frame between the drag starting and a
  // debounce firing would be laid out against dimensions that are already wrong,
  // and Ink throttles its own painting to 30fps anyway. The redraw is, because
  // it rewrites the whole transcript and a drag of the pane is sixty resizes,
  // only the last of which anyone reads.
  useEffect(() => {
    if (!stdout) return
    let redraw: ReturnType<typeof setTimeout> | undefined
    let last = stdout.columns
    const onResize = () => {
      setViewport({ columns: stdout.columns, rows: stdout.rows })
      const rewrapped = stdout.columns !== last
      last = stdout.columns
      if (!rewrapped) return
      clearTimeout(redraw)
      redraw = setTimeout(() => setGeneration((at) => at + 1), REDRAW_SETTLE_MS)
    }
    stdout.on('resize', onResize)
    return () => {
      clearTimeout(redraw)
      stdout.off('resize', onResize)
    }
  }, [stdout])

  // Every venue in the build, connected or not, so picking one from the menu is
  // the whole discovery step — no looking up names to type into a connect command.
  const venueEntries: VenueEntry[] = useMemo(() => {
    const { positions, failures } = session.current
    const now = new Date()
    return [...connectors.values()].map((connector) => {
      const id = connector.venue.id
      if (!connected.includes(id)) {
        return { id, connected: false, detail: `${connector.venue.name} — not connected` }
      }
      const failure = failures.find((f) => f.startsWith(`${id}:`))
      if (failure) {
        return { id, connected: true, detail: `FAILED — ${failure.split(': ').slice(1).join(': ')}` }
      }
      const mine = positions.filter((p) => belongsToVenue(p.venue, id))
      const stalest = mine.reduce((min, p) => (p.asOf < min ? p.asOf : min), now)
      return {
        id,
        connected: true,
        detail: `${holdings(connector.venue.kind, mine)} · ${freshness(stalest, now)}`,
      }
    })
  }, [session, connectors, connected, entries.length])

  useEffect(() => {
    void secrets.getPriceSource().then((stored) => setActivePrice(stored?.provider ?? DEFAULT_PROVIDER))
  }, [])

  const priceEntries: PriceEntry[] = useMemo(
    () =>
      PRICE_PROVIDERS.map((p) => ({
        id: p.id,
        active: p.id === activePrice,
        detail: p.id === activePrice ? `${p.name} — pricing everything` : p.summary,
      })),
    [activePrice],
  )

  const menu: Menu | null = useMemo(() => {
    if (!input.startsWith('/') || busy || menuDismissed) return null
    const rest = input.slice(1)
    const space = rest.indexOf(' ')

    if (space === -1) {
      const items: MenuItem[] = matchCommands(rest, venueEntries, priceEntries).map((c) => ({
        name: c.name,
        summary: c.summary,
        ...(c.args ? { args: c.args } : {}),
        ...(c.group ? { group: GROUP_LABELS[c.group] } : {}),
      }))
      if (items.length === 0) return null
      const all = matchCommands('', venueEntries, priceEntries)
      // Every row, plus the heading each group prints above its first.
      const total = all.length + new Set(all.map((c) => c.group)).size
      return { level: 'top', items, prefix: '/', total }
    }

    const head = rest.slice(0, space).toLowerCase()
    const tail = rest.slice(space + 1)
    if (tail.includes(' ')) return null

    const price = priceEntries.find((p) => p.id === head)
    if (price) {
      const subs: MenuItem[] = matchPriceSubcommands(tail, price.active).map((c) => ({
        name: c.name,
        summary: c.summary,
      }))
      if (subs.length === 0) return null
      return {
        level: 'venue',
        venue: head,
        items: subs,
        prefix: `/${head} `,
        heading: head,
        total: matchPriceSubcommands('', price.active).length,
      }
    }

    if (!connectors.has(head)) return null
    const entry = venueEntries.find((v) => v.id === head)
    const items: MenuItem[] = matchVenueSubcommands(tail, entry?.connected ?? false).map((c) => ({
      name: c.name,
      summary: c.summary,
    }))
    if (items.length === 0) return null
    return {
      level: 'venue',
      venue: head,
      items,
      prefix: `/${head} `,
      heading: connectors.get(head)?.venue.name ?? head,
      total: matchVenueSubcommands('', entry?.connected ?? false).length,
    }
  }, [input, busy, menuDismissed, venueEntries, priceEntries, connectors])

  const setLine = useCallback((value: string, at = value.length) => {
    setInput(value)
    setCursor(at)
    setMenuDismissed(false)
    setMenuIndex(0)
  }, [])

  const refreshConnected = useCallback(async () => {
    setConnected(await secrets.listVenues())
  }, [])

  // The status line claims an age, so it has to keep earning it. Without a tick
  // it reports whatever was true at the last keystroke, and a session left open
  // shows minute-old data as fresh.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  const status = useMemo(() => {
    const { positions, failures } = session.current
    const venues = new Set(positions.map((p) => p.venue)).size
    const stalest = session.stalest()
    const parts = [`${venues} venue${venues === 1 ? '' : 's'}`, `${positions.length} positions`]
    if (stalest) parts.push(freshness(stalest))
    if (failures.length > 0) parts.push(`${failures.length} failed`)
    parts.push(agent ? 'opus 5' : 'commands only')
    return parts.join('  ·  ')
  }, [session, agent, entries.length, streaming, connected, tick])

  const submit = useCallback(
    async (line: string) => {
      const trimmed = line.trim()
      setLine('')
      historyIndex.current = -1
      if (!trimmed) return

      setHistory((prev) => [...prev, trimmed])
      push('prompt', `❯ ${trimmed}`)
      setBusy(true)

      try {
        const parsed = parseCommand(trimmed, [...connectors.keys()])
        if (parsed) {
          const result = await dispatchCommand(session, connectors, parsed, venueEntries)
          if (result.kind === 'connect') {
            const connector = connectors.get(result.venue)
            if (connector) return setConnecting(connectable(connector))
            return
          }
          if (result.kind === 'connect-price') {
            const provider = priceProvider(result.provider)
            if (!provider) return
            setPendingPrice(provider.id)
            return setConnecting(asConnectable(provider))
          }
          if (result.kind === 'ui') {
            if (result.action === 'exit') return exit()
            if (result.action === 'clear') return clearScreen()
            if (result.action === 'login') return setOnboarding(true)
          } else {
            push('output', result.output)
            if (parsed.args[0] === 'disconnect') await refreshConnected()
          }
        } else if (agent) {
          setActivity('thinking')
          // The engine reads whatever the session last fetched. Asking before
          // the first load answers "nothing is connected" about a connected
          // venue — the one wrong answer this tool must never give.
          await session.ensureLoaded()
          let answer = ''
          let repeats = 0
          let lastTool = ''
          await agent.ask(trimmed, {
            onText: (delta) => {
              answer += delta
              setStreaming(answer)
              setActivity('')
            },
            onTool: (name) => {
              repeats = name === lastTool ? repeats + 1 : 0
              lastTool = name
              const label = TOOL_LABELS[name] ?? name
              setActivity(repeats > 0 ? `${label} (${repeats + 1}×)` : label)
            },
          })
          setStreaming('')
          if (answer.trim()) push('answer', answer.trim())
        } else {
          push(
            'notice',
            'That is a question, and answering questions needs an Anthropic API key.\nRun /login to set one, or type / for the commands, which never need it.',
          )
        }
      } catch (err) {
        setStreaming('')
        push('error', err instanceof TulaError ? err.message : String(err))
      } finally {
        setActivity('')
        setBusy(false)
      }
    },
    [session, connectors, agent, exit, push, setLine, venueEntries, refreshConnected],
  )

  /**
   * Opening the session should answer the question the session exists for. The
   * command is echoed rather than run invisibly, so the state on screen is
   * always traceable to something the user could have typed.
   */
  const showState = useCallback(async () => {
    const parsed = parseCommand('/exposure')
    if (!parsed) return
    setBusy(true)
    try {
      push('prompt', '❯ /exposure')
      const result = await dispatchCommand(session, connectors, parsed, venueEntries)
      if (result.kind === 'output') push('output', result.output)
    } catch (err) {
      push('error', err instanceof TulaError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [session, connectors, venueEntries, push])

  // Claimed by whichever path gets there first — mounting with venues already
  // stored, or a connect that just stored the first one. A ref, not state:
  // the claim has to land synchronously, before the next render can also make it.
  const openedWith = useRef(false)

  useEffect(() => {
    if (onboarding || connecting || openedWith.current) return
    // Connected but empty still deserves an answer: a venue that failed is the
    // most important thing to say on open, and it returns no positions.
    if (connected.length === 0) return
    openedWith.current = true
    void showState()
  }, [onboarding, connecting, connected, showState])

  const completeFromMenu = useCallback(() => {
    if (!menu) return
    const chosen = menu.items[menuIndex]
    if (!chosen) return
    setLine(`${menu.prefix}${chosen.name} `)
  }, [menu, menuIndex, setLine])

  const recallHistory = useCallback(
    (direction: -1 | 1) => {
      if (history.length === 0) return
      const current = historyIndex.current === -1 ? history.length : historyIndex.current
      const next = Math.min(history.length, Math.max(0, current + direction))
      historyIndex.current = next === history.length ? -1 : next
      setLine(next === history.length ? '' : (history[next] ?? ''))
      // A recalled line usually starts with a slash, which would re-open the
      // menu and hand it the next arrow — leaving history one step deep however
      // often you press. Typing or deleting anything brings the menu back.
      setMenuDismissed(true)
    },
    [history, setLine],
  )

  // Whether the transcript is holding anything back, so a toggle that would
  // change nothing on screen does not cost a redraw or the scrollback with it.
  const truncated = useMemo(
    () =>
      entries.some(
        (e) => e.kind !== 'prompt' && wrapLines(e.text, bodyWidth).length > PREVIEW_ROWS,
      ),
    [entries, bodyWidth],
  )

  const paletteItems = useMemo(
    () => buildPalette(venueEntries, priceEntries),
    [venueEntries, priceEntries],
  )
  const paletteMatches = useMemo(
    () => (palette ? matchPalette(palette.query, paletteItems) : []),
    [palette, paletteItems],
  )

  // Fixed, so filtering never resizes the block under the input line, but no
  // taller than the menu can fill or than the frame can afford: the input box,
  // the trailing count and the status line all come out of the same viewport —
  // and one more row of it while the expanded hint is up.
  const menuRows = Math.max(4, Math.min(rows - 8 - (expanded ? 1 : 0), menu?.total ?? 0))

  const toggleExpanded = useCallback(() => {
    setExpanded((on) => !on)
    if (!truncated || !stdout) return
    // <Static> is written once, so the transcript can only come back at the
    // other setting by being written again — the same redraw, and the same cost
    // in scrollback, that a width change owes.
    clearForRedraw(stdout)
    setGeneration((at) => at + 1)
  }, [truncated, stdout])

  const runFromPalette = useCallback(
    (entry: PaletteEntry, fill: boolean) => {
      setPalette(null)
      // Arguments cannot be guessed, so anything declaring them lands on the
      // line with the cursor where the first one goes, rather than running short.
      if (fill || !entry.runnable) return setLine(`/${entry.path} `)
      void submit(`/${entry.path}`)
    },
    [setLine, submit],
  )

  useInput(
    (ch, key) => {
      if (key.ctrl && ch === 'c') {
        if (palette) return setPalette(null)
        if (input.length > 0) return setLine('')
        return exit()
      }
      if (key.ctrl && ch === 'd' && input.length === 0) return exit()
      if (key.ctrl && ch === 'l') return clearScreen()

      // Above the busy gate on purpose: reading what an earlier command
      // returned is the natural thing to do while the next one is in flight.
      if (key.ctrl && ch === 'o') {
        setPalette(null)
        return toggleExpanded()
      }

      if (busy) return

      // Seeded from the line, so a half-typed command becomes the search
      // rather than something to close the palette and go back to.
      if (key.ctrl && ch === 'k') {
        return setPalette((p) => (p ? null : { query: input.replace(/^\//, ''), index: 0 }))
      }

      if (palette) {
        const chosen = paletteMatches[palette.index]
        if (key.escape) return setPalette(null)
        if (key.upArrow) {
          return setPalette((p) => (p ? { ...p, index: Math.max(0, p.index - 1) } : null))
        }
        if (key.downArrow) {
          const last = paletteMatches.length - 1
          return setPalette((p) => (p ? { ...p, index: Math.min(last, p.index + 1) } : null))
        }
        if (key.return || key.tab) {
          if (chosen) runFromPalette(chosen, key.tab)
          return
        }
        if (key.backspace || key.delete) {
          return setPalette((p) => (p ? { query: p.query.slice(0, -1), index: 0 } : null))
        }
        if (key.ctrl || key.meta || !ch) return
        const { text } = typed(ch)
        if (!text) return
        return setPalette((p) => (p ? { query: p.query + text, index: 0 } : null))
      }

      if (menu) {
        if (key.upArrow) return setMenuIndex((i) => Math.max(0, i - 1))
        if (key.downArrow) return setMenuIndex((i) => Math.min(menu.items.length - 1, i + 1))
        if (key.tab || key.return) return completeFromMenu()
        if (key.escape) return setMenuDismissed(true)
      } else {
        if (key.upArrow) return recallHistory(-1)
        if (key.downArrow) return recallHistory(1)
        if (key.return) return void submit(input)
      }

      if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1))
      if (key.rightArrow) return setCursor((c) => Math.min(input.length, c + 1))
      if (key.backspace || key.delete) {
        if (cursor === 0) return
        setInput(input.slice(0, cursor - 1) + input.slice(cursor))
        setCursor(cursor - 1)
        setMenuDismissed(false)
        return
      }
      if (key.ctrl || key.meta || key.tab || key.escape) return
      if (!ch) return

      const { text, submits } = typed(ch)
      const next = input.slice(0, cursor) + text + input.slice(cursor)
      if (submits) return void submit(next)
      setInput(next)
      setCursor(cursor + text.length)
      setMenuDismissed(false)
      setMenuIndex(0)
    },
    { isActive: !onboarding && !connecting },
  )

  if (onboarding) {
    return (
      <Onboarding
        onDone={(apiKey) => {
          setOnboarding(false)
          if (!apiKey) {
            // Null is either "continue without" or a browser sign-in that
            // completed out of process and left a profile behind.
            if (!agent && hasAmbientCredentials()) {
              setAgent(new Agent(riskEngineFor(session), {}))
              push('notice', 'Signed in. tula stored nothing — the Anthropic CLI holds the token.')
            }
            return
          }
          void secrets.putProviderKey(apiKey).catch(() => undefined)
          setAgent(new Agent(riskEngineFor(session), { apiKey }))
          push('notice', 'Key saved. Ask anything, or type / to connect a venue.')
        }}
      />
    )
  }

  if (connecting) {
    return (
      <ConnectFlow
        target={connecting}
        {...(pendingPrice
          ? {
              // A price source is not a venue: storing it under its own id would
              // make `listVenues` offer it as one, and Session would try to fetch
              // positions from a price feed.
              save: (creds: ConnectorCredentials) =>
                secrets.putPriceSource(pendingPrice, creds['apiKey']),
              doneMessage: (name: string) =>
                `Pricing from ${name}. Switching sources later forgets this key.`,
            }
          : {})}
        onDone={async (outcome) => {
          const provider = pendingPrice
          // Claimed before the first await. Storing a venue makes `connected`
          // non-empty, which re-arms the open-with-state effect; that effect
          // would run /exposure against the pre-connect cache and report an
          // empty book at the exact moment the user has one.
          openedWith.current = true
          setConnecting(null)
          setPendingPrice(null)
          push(outcome.ok ? 'notice' : 'output', outcome.message)
          if (!outcome.ok) return
          if (provider) {
            const stored = await secrets.getPriceSource()
            const { oracle } = buildOracle(
              provider,
              stored?.apiKey ? { apiKey: stored.apiKey } : undefined,
            )
            setActivePrice(provider)
            await session.useOracle(oracle)
          } else {
            await refreshConnected()
            await session.refresh()
          }
          await showState()
        }}
      />
    )
  }

  const nothingConnected = connected.length === 0
  // Address-only venues are the safest first thing to connect, so name them.
  const addressOnly = [...connectors.values()]
    .filter((c) => c.fields.every((f) => !f.secret))
    .map((c) => c.venue.name)

  return (
    <Box flexDirection="column" paddingRight={1}>
      <Static key={generation} items={entries}>
        {(entry) =>
          entry.kind === 'prompt' ? (
            // The line you asked for is a block, so a long transcript reads as a
            // sequence of questions rather than an undifferentiated wall.
            <Box
              key={entry.id}
              marginBottom={1}
              width={frameWidth}
              backgroundColor={theme.surface}
              paddingX={1}
            >
              <Text color={theme.accent}>{entry.text}</Text>
            </Box>
          ) : (
            <Output
              key={entry.id}
              kind={entry.kind}
              text={entry.text}
              width={bodyWidth}
              expanded={expanded}
            />
          )
        }
      </Static>

      {palette ? (
        <Palette
          query={palette.query}
          matches={paletteMatches}
          selected={palette.index}
          columns={frameWidth}
          rows={rows}
        />
      ) : (
        <>
        {nothingConnected && entries.length === 0 && (
          <Box marginBottom={1} paddingLeft={1} flexDirection="column">
            <Text color={theme.notice}>No venue connected yet, so there is nothing to measure.</Text>
            <Text dimColor>{`Type / and pick one — ${[...connectors.keys()].join(', ')}.`}</Text>
            <Text dimColor>
              {addressOnly.length > 0
                ? `${addressOnly.join(' and ')} need only a public address — no key, nothing to leak.`
                : 'Exchange keys must be read-only; tula verifies that before storing one.'}
            </Text>
          </Box>
        )}

        {streaming && (
          <Box marginBottom={1} paddingLeft={3}>
            <Text>{streaming}</Text>
          </Box>
        )}

        {busy && !streaming && (
          <Box marginBottom={1} paddingLeft={3}>
            <Text color={theme.accent}>{`${SPINNER[frame % SPINNER.length]} ${activity || 'working'}`}</Text>
          </Box>
        )}

        <Box
          borderStyle="round"
          borderColor={busy ? theme.muted : theme.accent}
          borderLeft={false}
          borderRight={false}
          paddingX={1}
        >
          <Text color={busy ? theme.muted : theme.accent}>{'❯ '}</Text>
          <InputLine
            value={input}
            cursor={cursor}
            dim={busy}
            placeholder={busy ? '' : 'ask anything · / for commands · ctrl+k to search them'}
          />
        </Box>

        {menu && (
          <SlashMenu
            items={menu.items}
            selected={menuIndex}
            prefix={menu.prefix}
            limit={menuRows}
            {...(menu.level === 'venue' ? { heading: menu.heading } : {})}
          />
        )}

        <Box paddingLeft={1} flexDirection="column">
          {/* Truncated on purpose: a status line that wraps is a row Ink counts
              as one, and its next erase leaves the remainder standing. */}
          <Text dimColor wrap="truncate">
            {status}
          </Text>
          {/* Nothing is marked "… more lines" while this is on, so the way back
              has to be somewhere that does not depend on there being one. */}
          {expanded && (
            <Text color={theme.notice} wrap="truncate">
              every line is shown · ctrl+o to collapse
            </Text>
          )}
        </Box>
        </>
      )}
    </Box>
  )
}

export function bannerText(): string {
  return `tula ${APP_VERSION}`
}
