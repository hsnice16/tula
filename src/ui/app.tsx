import { Box, Static, Text, useApp, useInput, useStdout } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Agent, envApiKey, envApiKeyName, hasAmbientCredentials } from '../agent/agent.js'
import {
  belongsToVenue,
  credentialName,
  credentialSource,
  type CredentialSource,
} from '../cli/commands.js'
import { riskEngineFor } from '../cli/engine-adapter.js'
import {
  buildPalette,
  GROUP_LABELS,
  matchCommands,
  matchPalette,
  matchPriceSubcommands,
  matchVenueSubcommands,
  parseCommand,
  priceEntries,
  type PaletteEntry,
  type PriceEntry,
  type VenueEntry,
} from '../cli/registry.js'
import type { LoadStep, Session } from '../cli/session.js'
import { dispatchCommand } from '../cli/shell.js'
import { pendingUpdate } from '../update/check.js'
import type { Connector } from '../connectors/types.js'
import { TulaError } from '../core/errors.js'
import * as secrets from '../secrets/store.js'
import { APP_DESCRIPTION, APP_VERSION } from '../version.js'
import { ConnectFlow } from './ConnectFlow.js'
import { connectable, type Connectable, type ConnectorCredentials } from '../connectors/types.js'
import {
  asConnectable,
  buildOracle,
  DEFAULT_PROVIDER,
  priceProvider,
} from '../prices/providers.js'
import { freshness, holdings } from '../core/format.js'
import { typed } from './keys.js'
import { askCursor, cursorRow } from './anchor.js'
import { mouseReport, trackMouse, type MouseReport } from './mouse.js'
import { Credentials, type CredentialsMode, type CredentialsResult } from './Credentials.js'
import { displayRows, FRAME_ROWS, Palette, paletteGeometry, windowRows } from './Palette.js'
import { offsetShowing, selectionIn, windowStart } from './scroll.js'
import { clearForRedraw } from './resize.js'
import { menuDisplay, SlashMenu, type MenuItem } from './SlashMenu.js'
import { InputLine } from './TextInput.js'
import { theme } from './theme.js'
import { wrapLines } from './wrap.js'

type EntryKind = 'prompt' | 'output' | 'answer' | 'error' | 'notice' | 'banner'

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

/** "A, B and C". Joining every pair with "and" read as a chant at three venues. */
const sentenceList = (items: string[]): string =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/** Short enough to feel live under a drag, long enough to coalesce its burst. */
const REDRAW_SETTLE_MS = 50

/** Drawn at, and subtracted from, the width an output block wraps against. */
const OUTPUT_INDENT = 3

/** What of an entry the transcript shows, the rows that takes, and what it holds back. */
function preview(
  text: string,
  width: number,
  expanded: boolean,
): { text: string; rows: number; hidden: number } {
  const rows = wrapLines(text, width)
  if (expanded || rows.length <= PREVIEW_ROWS) return { text, rows: rows.length, hidden: 0 }
  return {
    text: rows.slice(0, PREVIEW_ROWS).join('\n'),
    rows: PREVIEW_ROWS,
    hidden: rows.length - PREVIEW_ROWS,
  }
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

/**
 * The same voice, for the phase the tool labels do not cover: words arriving on
 * screen. It is what tells a part-written answer from a finished one.
 */
const RESPONDING = 'answering'

/** A load's step, in the voice the tool labels above are written in. */
function loadLabel(step: LoadStep): string {
  return step.kind === 'venue'
    ? `reading ${step.venue}`
    : `pricing ${step.assets} asset${step.assets === 1 ? '' : 's'}`
}

/**
 * The same figure `site/app/icon.svg` draws, in the units a terminal has:
 * strokes rather than letters for the reason that file gives, and seven columns
 * because a cell is twice as tall as it is wide — three rows of nine would be
 * the same mark lying on its side.
 */
const MARK = ['  ▄▄▄  ', '▄▟   ▙▄', '▄▄▄▄▄▄▄'] as const
const MARK_WIDTH = 7
const MARK_GUTTER = 2

const bannerTextWidth = (width: number) => Math.max(20, width - MARK_WIDTH - MARK_GUTTER)

/**
 * Wrapped here rather than by Ink, because the block's height has to be known
 * before it is drawn: `entryRows` measures the same banner to decide how much
 * of it the screen behind the palette has room for.
 */
function bannerRows(text: string, width: number): { text: string; head: boolean }[] {
  const columns = bannerTextWidth(width)
  return text
    .split('\n')
    .flatMap((line, at) => wrapLines(line, columns).map((row) => ({ text: row, head: at === 0 })))
}

function Line({ kind, text, dim }: { kind: EntryKind; text: string; dim: boolean }) {
  if (kind === 'prompt') return <Text color={theme.accent} dimColor={dim}>{text}</Text>
  if (kind === 'error') return <Text color={theme.danger} dimColor={dim}>{text}</Text>
  if (kind === 'notice') return <Text color={theme.notice} dimColor={dim}>{text}</Text>
  return <Text dimColor={dim}>{text}</Text>
}

function Output({
  kind,
  text,
  width,
  expanded,
  dim,
  trimTop,
}: {
  kind: EntryKind
  text: string
  width: number
  expanded: boolean
  dim: boolean
  trimTop: number
}) {
  const { text: shown, hidden } = preview(text, width, expanded)
  const cut = trimTop > 0 ? wrapLines(shown, width).slice(trimTop).join('\n') : shown
  return (
    <Box marginBottom={1} paddingLeft={OUTPUT_INDENT} flexDirection="column">
      <Line kind={kind} text={cut} dim={dim} />
      {hidden > 0 && (
        // The way out belongs where the dead end is, not in a help screen.
        <Text dimColor>{`… ${hidden} more line${hidden === 1 ? '' : 's'} · ctrl+o`}</Text>
      )}
    </Box>
  )
}

/**
 * One entry, drawn identically whether it is going into scrollback or being
 * copied back onto the screen behind the palette. Two renderers would drift.
 */
function TranscriptEntry({
  entry,
  frameWidth,
  bodyWidth,
  expanded,
  dim = false,
  trimTop = 0,
}: {
  entry: Entry
  frameWidth: number
  bodyWidth: number
  expanded: boolean
  /** Set for the copy behind the palette, which is a backdrop rather than the thing being read. */
  dim?: boolean
  /** Leading rows the top of the screen has already cut off. */
  trimTop?: number
}) {
  // Two columns, so the description wraps against its own width rather than
  // under the mark. Both are cut from the top by the same count: they start on
  // the same row, so that is where a screen scrolled past them loses them.
  if (entry.kind === 'banner') {
    const rows = bannerRows(entry.text, bodyWidth)
    return (
      <Box marginBottom={1} paddingLeft={OUTPUT_INDENT}>
        <Box flexDirection="column" marginRight={MARK_GUTTER} width={MARK_WIDTH}>
          {MARK.slice(trimTop).map((row, at) => (
            <Text key={`${at}:${row}`} color={theme.accent} dimColor={dim}>
              {row}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" width={bannerTextWidth(bodyWidth)}>
          {rows.slice(trimTop).map(({ text, head }, at) =>
            head ? (
              <Text key={`${at}:${text}`} bold color={theme.accent} dimColor={dim}>
                {text}
              </Text>
            ) : (
              <Text key={`${at}:${text}`} dimColor>
                {text}
              </Text>
            ),
          )}
        </Box>
      </Box>
    )
  }

  // The line you asked for is a block, so a long transcript reads as a sequence
  // of questions rather than an undifferentiated wall.
  if (entry.kind === 'prompt') {
    return (
      <Box marginBottom={1} width={frameWidth} backgroundColor={theme.surface} paddingX={1}>
        <Text color={theme.accent} dimColor={dim}>
          {entry.text}
        </Text>
      </Box>
    )
  }
  return (
    <Output
      kind={entry.kind}
      text={entry.text}
      width={bodyWidth}
      expanded={expanded}
      dim={dim}
      trimTop={trimTop}
    />
  )
}

/** What `TranscriptEntry` will occupy, so the copy can be cut to the rows it has. */
function entryRows(entry: Entry, width: number, expanded: boolean): number {
  if (entry.kind === 'prompt') return 2
  // The banner is not in `entries`, so nothing measures it today. It is here
  // because `preview` is the wrong ruler for a two-column block, and a height
  // that disagrees with what was drawn clips the backdrop by the difference.
  if (entry.kind === 'banner') return Math.max(MARK.length, bannerRows(entry.text, width).length) + 1
  const { rows, hidden } = preview(entry.text, width, expanded)
  return rows + (hidden > 0 ? 1 : 0) + 1
}

/**
 * The last entries that fit, with the one that overruns cut to the rows it has
 * left — which is what the top of a scrolled screen looks like. Cutting here
 * rather than clipping the box is the only version that is exact: Yoga overflows
 * a bottom-aligned column downwards, so the rows lost are the newest, not the
 * oldest, and every write after the first lands on the one before it.
 */
function transcriptTail(entries: Entry[], budget: number, width: number, expanded: boolean) {
  const tail: { entry: Entry; trimTop: number }[] = []
  let used = 0
  for (let at = entries.length - 1; at >= 0; at--) {
    const entry = entries[at]
    if (!entry) break
    const height = entryRows(entry, width, expanded)
    if (used + height > budget) {
      // Under two rows only the margin is left to draw. A prompt is a block,
      // and half of one reads as broken rather than as scrolled past.
      const room = budget - used
      if (entry.kind !== 'prompt' && room > 1) tail.unshift({ entry, trimTop: height - room })
      break
    }
    used += height
    tail.unshift({ entry, trimTop: 0 })
  }
  return tail
}

type Menu = { items: MenuItem[]; prefix: string; heading?: string } & (
  | { level: 'top' }
  | { level: 'venue'; venue: string; heading: string }
) & {
  /** Rows the unfiltered menu would need. Fixing the block at this height keeps
   *  it from resizing as you type without reserving space it can never use. */
  total: number
}

interface CredentialsScreen {
  mode: CredentialsMode
  /** Read when the screen opens: only the store knows disk from environment. */
  source: CredentialSource
}

interface Props {
  session: Session
  connectors: Map<string, Connector>
  initialApiKey: string | undefined
  initialVenues: string[]
  /**
   * Injected in tests; never in the product, which builds one from whatever
   * credential it found. A screen with an answer half-written on it is a frame
   * only a model in mid-turn produces, and the real one cannot be held there.
   */
  agent?: Agent
}

export function App({ session, connectors, initialApiKey, initialVenues, agent: given }: Props) {
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

  const [agent, setAgent] = useState<Agent | null>(
    () =>
      given ??
      // An `ant auth login` profile is a credential too: gating on a key string
      // alone hides the agent from a user who is already signed in.
      (initialApiKey || hasAmbientCredentials()
        ? new Agent(riskEngineFor(session), initialApiKey ? { apiKey: initialApiKey } : {})
        : null),
  )
  // An ambient profile is a credential, so it settles this screen exactly as it
  // settles the agent above. Gating on the key string alone asked a user who was
  // already signed in to sign in again on every start, while the status line
  // beside it reported the agent live.
  const [credentials, setCredentials] = useState<CredentialsScreen | null>(() =>
    initialApiKey === undefined && !hasAmbientCredentials()
      ? { mode: 'first-run', source: 'none' }
      : null,
  )
  const [connecting, setConnecting] = useState<Connectable | null>(null)
  // Set only while a price source is being keyed, so onDone knows to activate it.
  const [pendingPrice, setPendingPrice] = useState<string | null>(null)
  const [activePrice, setActivePrice] = useState<string>(DEFAULT_PROVIDER)
  const [connected, setConnected] = useState<string[]>(initialVenues)

  const [entries, setEntries] = useState<Entry[]>([])
  /**
   * Written into the transcript rather than drawn in the frame: it is this
   * session's opening record, so it scrolls away as the transcript grows
   * instead of sitting pinned above it. Kept out of `entries` so that clearing
   * them, or asking whether any exist, is unaffected by it being there.
   */
  const banner = useMemo<Entry>(
    () => ({
      id: -1,
      kind: 'banner',
      text: [
        `tula ${APP_VERSION}`,
        APP_DESCRIPTION,
        ...(initialVenues.length > 0 ? [`Connected: ${initialVenues.join(', ')}`] : []),
      ].join('\n'),
    }),
    [initialVenues],
  )
  const [input, setInput] = useState('')
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState('')
  const [streaming, setStreaming] = useState('')
  const [frame, setFrame] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuOffset, setMenuOffset] = useState(0)
  /**
   * The row the terminal says its cursor is on, which is the only fixed point
   * between the pointer's absolute rows and a frame drawn wherever the
   * transcript left off. Null until the terminal answers, or for good on one
   * that never does — the menu still takes the keyboard and the wheel.
   */
  const [anchor, setAnchor] = useState<number | null>(null)
  const [menuDismissed, setMenuDismissed] = useState(false)
  const [palette, setPalette] = useState<{ query: string; index: number; offset: number } | null>(
    null,
  )
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

  /**
   * <Static> writes each entry to the terminal once, so emptying the transcript
   * leaves every row of it exactly where it was: the command read as one that
   * did nothing, and added a row saying so. The screen is what the user means,
   * so it goes too, and the redraw that follows puts back the banner alone.
   */
  const clearScreen = useCallback(() => {
    if (stdout) clearForRedraw(stdout)
    setEntries([])
    setGeneration((at) => at + 1)
  }, [stdout])

  /**
   * Writes what the screen chose, then re-reads the credential the same way
   * `src/index.ts` does and rebuilds the agent from that. Re-reading is the
   * point: a saved key is not necessarily the key a question goes out with, and
   * saying "signed in" over a credential that something else outranks is the
   * kind of confident wrong answer this tool must not give about itself.
   */
  const applyCredentials = useCallback(
    async (result: CredentialsResult) => {
      try {
        if (result.kind === 'key') await secrets.putProviderKey(result.apiKey)
        if (result.kind === 'signed-out') await secrets.removeProviderKey()
      } catch (err) {
        return push('error', err instanceof TulaError ? err.message : String(err))
      }

      const source = await credentialSource()
      const key = envApiKey() ?? (await secrets.getProviderKey())
      setAgent(
        source === 'none' ? null : new Agent(riskEngineFor(session), key ? { apiKey: key } : {}),
      )

      if (result.kind === 'key') {
        return push(
          'notice',
          source === 'env'
            ? `Key saved, but ${envApiKeyName()} is set in your shell and wins over it.\n` +
              'Unset that variable to use the key you just saved.'
            : 'Key saved. Ask anything, or type / to connect a venue.',
        )
      }
      if (result.kind === 'signed-out') {
        return push(
          'notice',
          source === 'none'
            ? 'Signed out. Plain English is off; every command still works.'
            : `Key forgotten. Plain English now uses ${credentialName(source)}.`,
        )
      }
      if (source === 'none') {
        return push('error', 'Nothing signed in. Try again, or paste an API key.')
      }
      push(
        'notice',
        source === 'ambient'
          ? 'Signed in. tula saved nothing — the Anthropic CLI holds the token.'
          : `Signed in, but ${credentialName(source)} wins over it — that is what questions use.`,
      )
    },
    [session, push],
  )

  // A spinner says something is running; only the count says for how long, which
  // is the question a wait long enough to look like a hang actually raises.
  useEffect(() => {
    if (!busy) return
    const startedAt = Date.now()
    setElapsed(0)
    const timer = setInterval(() => {
      setFrame((f) => f + 1)
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 80)
    return () => clearInterval(timer)
  }, [busy])

  /**
   * One line, once a day at most, and only about a version not mentioned before.
   * It is a `notice` in the transcript rather than anything pinned: somebody who
   * opened tula to read a liquidation price is not to be interrupted by tula.
   *
   * Nothing is awaited on the way in. A slow or unreachable GitHub delays this
   * line and nothing else, and a failed check is silence — see `pendingUpdate`.
   */
  useEffect(() => {
    let live = true
    void pendingUpdate().then((found) => {
      if (live && found) {
        push('notice', `tula ${found.version} is out — you have ${APP_VERSION}.  /update`)
      }
    })
    return () => {
      live = false
    }
  }, [push])

  // The session names each venue as it reads it. Nothing else can: a command
  // calls `ensureLoaded` several layers down, long after the UI let go of it.
  useEffect(() => {
    session.onProgress = (step) => setActivity(step ? loadLabel(step) : '')
    return () => {
      session.onProgress = null
    }
  }, [session])

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
      const addressOnly = !connector.fields.some((f) => f.secret)
      if (!connected.includes(id)) {
        return { id, connected: false, addressOnly, detail: `${connector.venue.name} — not connected` }
      }
      const failure = failures.find((f) => f.startsWith(`${id}:`))
      if (failure) {
        return {
          id,
          connected: true,
          addressOnly,
          detail: `FAILED — ${failure.split(': ').slice(1).join(': ')}`,
        }
      }
      const mine = positions.filter((p) => belongsToVenue(p.venue, id))
      // reduce() over no rows answers with its seed, so a venue connected and
      // holding nothing drew the current time as the age of data it does not
      // have — in the menu AGENTS.md calls the venue overview. Same fix as
      // `venueStatus` in src/cli/commands.ts.
      const stalest = mine.reduce<Date | null>((min, p) => (min && min < p.asOf ? min : p.asOf), null)
      const held = holdings(connector.venue.kind, mine)
      return {
        id,
        connected: true,
        addressOnly,
        detail: stalest ? `${held} · ${freshness(stalest, now)}` : held,
      }
    })
  }, [session, connectors, connected, entries.length])

  useEffect(() => {
    void secrets.getPriceSource().then((stored) => setActivePrice(stored?.provider ?? DEFAULT_PROVIDER))
  }, [])

  const prices: PriceEntry[] = useMemo(() => priceEntries(activePrice), [activePrice])

  const menu: Menu | null = useMemo(() => {
    if (!input.startsWith('/') || busy || menuDismissed) return null
    const rest = input.slice(1)
    const space = rest.indexOf(' ')

    if (space === -1) {
      const items: MenuItem[] = matchCommands(rest, venueEntries, prices).map((c) => ({
        name: c.name,
        summary: c.summary,
        ...(c.args ? { args: c.args } : {}),
        ...(c.group ? { group: GROUP_LABELS[c.group] } : {}),
      }))
      if (items.length === 0) return null
      const all = matchCommands('', venueEntries, prices)
      // Every row, plus the heading each group prints above its first.
      const total = all.length + new Set(all.map((c) => c.group)).size
      return { level: 'top', items, prefix: '/', total }
    }

    const head = rest.slice(0, space).toLowerCase()
    const tail = rest.slice(space + 1)
    if (tail.includes(' ')) return null

    const price = prices.find((p) => p.id === head)
    if (price) {
      const subs: MenuItem[] = matchPriceSubcommands(tail, price).map((c) => ({
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
        total: matchPriceSubcommands('', price).length,
      }
    }

    if (!connectors.has(head)) return null
    const entry = venueEntries.find((v) => v.id === head)
    const items: MenuItem[] = matchVenueSubcommands(
      tail,
      entry?.connected ?? false,
      entry?.addressOnly ?? false,
    ).map((c) => ({
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
  }, [input, busy, menuDismissed, venueEntries, prices, connectors])

  const setLine = useCallback((value: string, at = value.length) => {
    setInput(value)
    setCursor(at)
    setMenuDismissed(false)
    setMenuIndex(0)
    setMenuOffset(0)
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
    const parts = [
      `${venues} venue${venues === 1 ? '' : 's'}`,
      `${positions.length} position${positions.length === 1 ? '' : 's'}`,
    ]
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
            if (result.action === 'login')
              return setCredentials({ mode: 'manage', source: await credentialSource() })
          } else {
            push('output', result.output)
            // Both commands that take credentials off disk, not just the one
            // spelled as a subcommand: /forget left the menu drawing a venue as
            // connected, and /<venue> status answering from the connected branch,
            // for the rest of the session.
            if (parsed.args[0] === 'disconnect' || parsed.name === 'forget') {
              await refreshConnected()
            }
          }
        } else if (agent) {
          // The engine reads whatever the session last fetched. Asking before
          // the first load answers "nothing is connected" about a connected
          // venue — the one wrong answer this tool must never give.
          await session.ensureLoaded()
          let answer = ''
          let repeats = 0
          let lastTool = ''
          // A turn boundary is where the model stopped to use a tool, and the
          // deltas do not carry it. Concatenating across it ran the sentence it
          // left off on straight into the answer that came back.
          let seam = false
          await agent.ask(trimmed, {
            onTurn: () => {
              seam = answer !== ''
              setActivity('thinking')
            },
            onText: (delta) => {
              if (seam) {
                answer += '\n\n'
                seam = false
              }
              answer += delta
              setStreaming(answer)
              setActivity(RESPONDING)
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
    if (credentials || connecting || openedWith.current) return
    // Connected but empty still deserves an answer: a venue that failed is the
    // most important thing to say on open, and it returns no positions.
    if (connected.length === 0) return
    openedWith.current = true
    void showState()
  }, [credentials, connecting, connected, showState])

  const completeFromMenu = useCallback(
    (at = menuIndex) => {
      if (!menu) return
      const chosen = menu.items[at]
      if (!chosen) return
      setLine(`${menu.prefix}${chosen.name} `)
    },
    [menu, menuIndex, setLine],
  )

  /**
   * Completing on Enter as well as tab cost every command a second press — the
   * first closed the menu with nothing to show for it, which reads as the key
   * having been missed. Arguments cannot be guessed, so a command declaring them
   * still lands on the line with the cursor where the first one goes, as in ctrl+k.
   */
  const runFromMenu = useCallback(
    (at = menuIndex) => {
      if (!menu) return
      const chosen = menu.items[at]
      if (!chosen) return
      if (chosen.args) return completeFromMenu(at)
      void submit(`${menu.prefix}${chosen.name}`)
    },
    [menu, menuIndex, completeFromMenu, submit],
  )

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
        (e) => e.kind !== 'prompt' && preview(e.text, bodyWidth, false).hidden > 0,
      ),
    [entries, bodyWidth],
  )

  const paletteItems = useMemo(
    () => buildPalette(venueEntries, prices),
    [venueEntries, prices],
  )
  const paletteMatches = useMemo(
    () => (palette ? matchPalette(palette.query, paletteItems) : []),
    [palette, paletteItems],
  )
  // The rows the dialog will draw, measured here too: scrolling counts in those
  // rather than in matches, and the two have to agree on where the window is.
  const paletteRows = useMemo(
    () => (palette ? displayRows(paletteMatches, palette.query) : []),
    [palette, paletteMatches],
  )
  const paletteLimit = windowRows(viewport.rows)

  // Fixed, so filtering never resizes the block under the input line, but no
  // taller than the menu can fill or than the frame can afford: the input box,
  // the trailing count and the status line all come out of the same viewport —
  // and one more row of it while the expanded hint is up.
  const menuRows = Math.max(4, Math.min(rows - 8 - (expanded ? 1 : 0), menu?.total ?? 0))

  // What the copy behind the dialog has left once the frame under it is drawn,
  // plus the row the ctrl+o hint adds to the status line while it is up.
  const backdropRows = Math.max(0, rows - FRAME_ROWS - (expanded ? 1 : 0))

  const toggleExpanded = useCallback(() => {
    setExpanded((on) => !on)
    if (!truncated || !stdout) return
    // <Static> is written once, so the transcript can only come back at the
    // other setting by being written again — the same redraw, and the same cost
    // in scrollback, that a width change owes.
    clearForRedraw(stdout)
    setGeneration((at) => at + 1)
  }, [truncated, stdout])

  /**
   * The frame is about to grow from a few rows to the whole viewport, and a
   * terminal makes that room by scrolling: the transcript slides up under the
   * dialog, and the copy that goes over the top stays there to be scrolled back
   * into. Clearing first lands the frame on an empty screen at exactly its own
   * height — nothing moves, and there is nothing behind it to scroll to.
   */
  const openPalette = useCallback(() => {
    if (stdout) clearForRedraw(stdout)
    setPalette({ query: input.replace(/^\//, ''), index: 0, offset: 0 })
  }, [stdout, input])

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

  /**
   * The dialog answers the pointer the way a dialog is expected to: the row
   * under it lights up, a click on that row runs it, the bar takes a click
   * anywhere along its length, and a click on the screen outside is the way out.
   */
  const menuDisplayRows = useMemo(() => (menu ? menuDisplay(menu.items) : []), [menu])

  /**
   * Where the menu block sits on screen, once the terminal has said where its
   * cursor is. Everything below the list is fixed height — the "more" line, the
   * status line, and the row the cursor itself is parked on — so the list is a
   * constant distance up from it, wherever the frame ended up.
   */
  const menuBand = useMemo(() => {
    if (anchor === null || !menu) return null
    const last = anchor - 3 - (expanded ? 1 : 0)
    return { first: last - menuRows + 1, last }
  }, [anchor, menu, expanded, menuRows])

  /**
   * The same three things the dialog does, against a block that is part of the
   * frame rather than floating over it: the row under the pointer lights up, a
   * click runs it, and a click anywhere else puts the menu away. The wheel is
   * the exception — it needs no anchor, so it works on a terminal that never
   * answered where the cursor is.
   */
  const onMenuMouse = useCallback(
    (report: MouseReport): void => {
      if (!menu) return
      if (report.kind === 'wheel') {
        const furthest = Math.max(0, menuDisplayRows.length - menuRows)
        const offset = Math.max(0, Math.min(menuOffset + report.step, furthest))
        setMenuOffset(offset)
        setMenuIndex((i) => selectionIn(menuDisplayRows, menuRows, offset, i))
        return
      }
      if (report.kind === 'release' || !menuBand) return

      const row = report.row - 1
      if (row < menuBand.first || row > menuBand.last) {
        // Clicking away from an autocomplete is how one is dismissed; the line
        // itself is untouched, so it can be brought back by typing.
        if (report.kind === 'press') setMenuDismissed(true)
        return
      }
      const start = windowStart(menuDisplayRows, menuRows, menuOffset)
      const item = menuDisplayRows[start + (row - menuBand.first)]
      if (item?.kind !== 'row') return
      if (report.kind === 'press') return runFromMenu(item.at)
      if (item.at !== menuIndex) setMenuIndex(item.at)
    },
    [menu, menuBand, menuDisplayRows, menuRows, menuOffset, menuIndex, runFromMenu],
  )

  const onPaletteMouse = useCallback(
    (report: MouseReport): void => {
      if (!palette) return
      const box = paletteGeometry(viewport.columns, viewport.rows)
      const furthest = Math.max(0, paletteRows.length - box.limit)
      const scrollTo = (offset: number) =>
        setPalette((p) =>
          p
            ? { ...p, offset, index: selectionIn(paletteRows, box.limit, offset, p.index) }
            : null,
        )

      if (report.kind === 'wheel') {
        // The list moves, not the cursor: a window that follows the selection
        // spends the first notches inside the rows already on screen, which
        // reads as a wheel the list is ignoring.
        return scrollTo(Math.max(0, Math.min(palette.offset + report.step, furthest)))
      }
      if (report.kind === 'release') return

      const row = report.row - 1
      const column = report.column - 1
      const inside =
        row >= box.top &&
        row < box.top + box.height &&
        column >= box.left &&
        column < box.left + box.width
      if (!inside) {
        if (report.kind === 'press') setPalette(null)
        return
      }

      // Anywhere along the bar, not only on the thumb: the thumb is a row or two
      // tall on a list this long, and nothing that small is a target.
      if (column === box.barColumn && report.kind !== 'move') {
        const along = Math.max(0, Math.min(row - box.listTop, box.limit - 1))
        return scrollTo(box.limit > 1 ? Math.round((along / (box.limit - 1)) * furthest) : 0)
      }

      const onList =
        row >= box.listTop &&
        row < box.listTop + box.limit &&
        column >= box.listLeft &&
        column < box.listLeft + box.listWidth
      if (!onList) return
      const start = windowStart(paletteRows, box.limit, palette.offset)
      const item = paletteRows[start + (row - box.listTop)]
      if (item?.kind !== 'row') return
      if (report.kind === 'press') return runFromPalette(item.entry, false)
      // Hovering, and only where that is a change: a report arrives for every
      // cell the pointer crosses, and a render for each one is the stutter.
      if (item.at !== palette.index) setPalette((p) => (p ? { ...p, index: item.at } : null))
    },
    [palette, paletteRows, viewport, runFromPalette],
  )

  // Only while one of the two lists is up, and undone on the way out: see
  // mouse.ts for what it costs the rest of the screen.
  const menuOpen = menu !== null
  const paletteOpen = palette !== null
  useEffect(() => {
    if (!(paletteOpen || menuOpen) || !stdout) return
    return trackMouse(stdout)
  }, [paletteOpen, menuOpen, stdout])

  /**
   * Asked again on every keystroke the menu is open for, rather than once when
   * it opens: a line long enough to wrap makes the input box a row taller and
   * moves everything under it. Nothing is written to the transcript meanwhile —
   * the menu is closed while a command is in flight — so the answer cannot go
   * stale between being asked for and arriving.
   */
  useEffect(() => {
    if (!menuOpen || !stdout) return setAnchor(null)
    askCursor(stdout)
  }, [menuOpen, stdout, input, viewport])

  useInput(
    (ch, key) => {
      // Before everything, including the busy gate: a report that reaches the
      // bottom of this handler is typed in as the punctuation it looks like.
      const report = mouseReport(ch)
      if (report) return palette ? onPaletteMouse(report) : onMenuMouse(report)
      const answered = cursorRow(ch)
      if (answered !== null) return setAnchor(answered)

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
        if (palette) return setPalette(null)
        return openPalette()
      }

      if (palette) {
        const chosen = paletteMatches[palette.index]
        if (key.escape) return setPalette(null)
        if (key.upArrow || key.downArrow) {
          const last = paletteMatches.length - 1
          const step = key.upArrow ? -1 : 1
          return setPalette((p) => {
            if (!p) return null
            const index = Math.max(0, Math.min(last, p.index + step))
            return { ...p, index, offset: offsetShowing(paletteRows, paletteLimit, p.offset, index) }
          })
        }
        if (key.return || key.tab) {
          if (chosen) runFromPalette(chosen, key.tab)
          return
        }
        if (key.backspace || key.delete) {
          return setPalette((p) => (p ? { query: p.query.slice(0, -1), index: 0, offset: 0 } : null))
        }
        if (key.ctrl || key.meta || !ch) return
        const { text } = typed(ch)
        if (!text) return
        return setPalette((p) => (p ? { query: p.query + text, index: 0, offset: 0 } : null))
      }

      if (menu) {
        if (key.upArrow || key.downArrow) {
          const last = menu.items.length - 1
          const step = key.upArrow ? -1 : 1
          const index = Math.max(0, Math.min(last, menuIndex + step))
          setMenuIndex(index)
          return setMenuOffset((o) => offsetShowing(menuDisplayRows, menuRows, o, index))
        }
        if (key.tab) return completeFromMenu()
        if (key.return) return runFromMenu()
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
      setMenuOffset(0)
    },
    { isActive: !credentials && !connecting },
  )

  /**
   * Drawn inside the tree, not returned in place of it. Replacing the whole
   * App unmounts <Static>, and remounting it writes the entire transcript a
   * second time under the copy already on screen — the ghost the width redraw
   * exists to avoid, for a panel that only ever meant to cover the frame.
   */
  const panel = credentials ? (
    <Credentials
      mode={credentials.mode}
      source={credentials.source}
      onDone={(result) => {
        setCredentials(null)
        if (result.kind !== 'cancelled') void applyCredentials(result)
      }}
    />
  ) : connecting ? (
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
  ) : null

  const nothingConnected = connected.length === 0
  // Address-only venues are the safest first thing to connect, so name them.
  const addressOnly = [...connectors.values()]
    .filter((c) => c.fields.every((f) => !f.secret))
    .map((c) => c.venue.name)

  // Drawn either as the live frame or, with the palette open, as the copy the
  // dialog floats over — so what is behind it is the screen, not an echo of it.
  // Behind the dialog it is inert, and reads that way: the same treatment a
  // command in flight gets, because in both cases the line is not taking input.
  const renderInputBox = (inert: boolean) => (
    <Box
      borderStyle="round"
      borderColor={busy || inert ? theme.muted : theme.accent}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Text color={busy || inert ? theme.muted : theme.accent}>{'❯ '}</Text>
      <InputLine
        value={input}
        cursor={cursor}
        dim={busy || inert}
        placeholder={busy ? '' : 'ask anything · / for commands · ctrl+k to search them'}
      />
    </Box>
  )

  const statusBox = (
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
  )

  return (
    <Box flexDirection="column" paddingRight={1}>
      <Static key={generation} items={[banner, ...entries]}>
        {(entry) => (
          <TranscriptEntry
            key={entry.id}
            entry={entry}
            frameWidth={frameWidth}
            bodyWidth={bodyWidth}
            expanded={expanded}
          />
        )}
      </Static>

      {panel ??
        (palette ? (
          <Palette
            query={palette.query}
            matches={paletteMatches}
            selected={palette.index}
            offset={palette.offset}
            columns={frameWidth}
            rows={rows}
            behind={
              <>
                {transcriptTail(entries, backdropRows, bodyWidth, expanded).map(
                  ({ entry, trimTop }) => (
                    <TranscriptEntry
                      key={entry.id}
                      entry={entry}
                      frameWidth={frameWidth}
                      bodyWidth={bodyWidth}
                      expanded={expanded}
                      dim
                      trimTop={trimTop}
                    />
                  ),
                )}
                {/* Only ever the shortfall when the whole transcript is shorter
                    than the screen, which is where the real one leaves it too. */}
                <Box flexGrow={1} />
                {renderInputBox(true)}
                {statusBox}
              </>
            }
          />
        ) : (
          <>
            {nothingConnected && entries.length === 0 && (
              <Box marginBottom={1} paddingLeft={1} flexDirection="column">
                <Text color={theme.notice}>
                  No venue connected yet, so there is nothing to measure.
                </Text>
                <Text dimColor>{`Type / and pick one — ${[...connectors.keys()].join(', ')}.`}</Text>
                <Text dimColor>
                  {addressOnly.length > 0
                    ? `${sentenceList(addressOnly)} ${addressOnly.length === 1 ? 'needs' : 'need'} only a public address — no key, nothing to leak.`
                    : 'Exchange keys must be read-only; tula verifies that before storing one.'}
                </Text>
              </Box>
            )}

            {streaming && (
              <Box marginBottom={1} paddingLeft={3}>
                <Text>{streaming}</Text>
              </Box>
            )}

            {/* Through every phase, not only the ones with nothing above it. An
                answer that stops to read a tool goes on working with prose
                already on screen, and a row that left with the first token took
                the only sign of that with it. */}
            {busy && (
              <Box marginBottom={1} paddingLeft={3}>
                <Text color={theme.accent} wrap="truncate">
                  {`${SPINNER[frame % SPINNER.length]} ${activity || 'working'}`}
                  {elapsed > 0 ? `  ·  ${elapsed}s` : ''}
                </Text>
              </Box>
            )}

            {renderInputBox(false)}

            {menu && (
              <SlashMenu
                items={menu.items}
                selected={menuIndex}
                prefix={menu.prefix}
                limit={menuRows}
                offset={menuOffset}
                {...(menu.level === 'venue' ? { heading: menu.heading } : {})}
              />
            )}

            {statusBox}
          </>
        ))}
    </Box>
  )
}
