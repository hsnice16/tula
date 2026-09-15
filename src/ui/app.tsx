import { Box, Static, Text, useApp, useInput, usePaste, useStdout } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Agent, envApiKey, envApiKeyName, hasAmbientCredentials, StoppedError } from '../agent/agent.js'
import {
  answeredInPart,
  credentialName,
  credentialSource,
  failedVenue,
  type CredentialSource,
} from '../cli/commands.js'
import { riskEngineFor } from '../cli/engine-adapter.js'
import { belongsToVenue } from '../core/position.js'
import {
  argumentList,
  buildPalette,
  type Candidate,
  type CandidateContext,
  GROUP_LABELS,
  matchCommands,
  matchPalette,
  matchPriceSubcommands,
  matchVenueSubcommands,
  parseCommand,
  priceEntries,
  forgetCommand,
  type PaletteEntry,
  type ParsedCommand,
  type PriceEntry,
  type VenueEntry,
} from '../cli/registry.js'
import type { LoadStep, Session } from '../cli/session.js'
import { dispatchCommand } from '../cli/shell.js'
import { pendingUpdate } from '../update/check.js'
import type { Connector } from '../connectors/types.js'
import { failureText } from '../core/errors.js'
import * as secrets from '../secrets/store.js'
import { homeRelative } from '../core/paths.js'
import { APP_DESCRIPTION, APP_VERSION } from '../version.js'
import { ConnectFlow } from './ConnectFlow.js'
import {
  connectable,
  storedVenues,
  type Connectable,
  type ConnectorCredentials,
} from '../connectors/types.js'
import {
  asConnectable,
  buildOracle,
  DEFAULT_PROVIDER,
  priceProvider,
} from '../prices/providers.js'
import { downloaded, freshness, holdings } from '../core/format.js'
import {
  clearHistory,
  findInHistory,
  HISTORY_LIMIT,
  historyOff,
  historyPath,
  readHistory,
  recordable,
  recordHistory,
} from '../history/history.js'
import { readPreferences, writePreferences } from '../prefs/prefs.js'
import { editingCommand, enterKey, isLineCommand, keyAction, pasted, typed, type ShellKey } from './keys.js'
import { keysText } from './keymap.js'
import { replay, vimEscape, vimState, vimTyped, vimUntracked, type VimState } from './vim.js'
import {
  before,
  edit,
  forwardWord,
  insert,
  lineEditor,
  moveRow,
  replace,
  visualRows,
  type LineEditor,
} from './line.js'
import { askCursor, askKeyboard, terminalReply } from './anchor.js'
import { mouseReports, trackMouse, type MouseReport } from './mouse.js'
import { Credentials, type CredentialsMode, type CredentialsResult } from './Credentials.js'
import { displayRows, FRAME_ROWS, Palette, paletteGeometry, windowRows } from './Palette.js'
import { offsetShowing, selectionIn, windowStart } from './scroll.js'
import { clearForRedraw } from './resize.js'
import { menuDisplay, SlashMenu, type MenuItem } from './SlashMenu.js'
import { INPUT_ROWS, InputLine } from './TextInput.js'
import { theme } from './theme.js'
import { cells, wrapLines } from './wrap.js'

type EntryKind = 'prompt' | 'output' | 'answer' | 'error' | 'notice' | 'banner'

interface Entry {
  id: number
  kind: EntryKind
  text: string
  /**
   * The tail of `text` that truncation may not hold back. A total omitting a
   * venue prints `INCOMPLETE` beneath it, and that block is appended last —
   * exactly where the preview cuts, so past twelve rows the answer arrived
   * looking whole and the caveat did not arrive at all.
   */
  pinned?: string
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const PLACEHOLDER = 'ask anything · / for commands · ctrl+s to search them'
/**
 * The pointer to the `?` panel, last so it is what goes when the row is too
 * narrow for it — Codex's footer drops "? for shortcuts" first.
 */
const PLACEHOLDER_HINTED = `${PLACEHOLDER} · ? for shortcuts`

/** Queued lines drawn before the rest are counted, as Gemini CLI draws three. */
const QUEUE_ROWS = 3

/** While something runs: what Enter and Esc do now that the line takes keys. */
const PLACEHOLDER_BUSY = 'type the next one · Enter queues it · Esc stops a question'

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

/**
 * What of an entry the transcript shows, the rows that takes, and what it holds
 * back — with `pinned` held over to the far side of the count, so the block
 * saying the answer is incomplete lands under the answer whatever its length.
 * Pinning the whole of an entry is how one says it must not be truncated at all.
 */
function preview(
  text: string,
  width: number,
  expanded: boolean,
  pinned = '',
): { head: string; rows: number; hidden: number; tail: string } {
  const rows = wrapLines(text, width)
  const whole = { head: text, rows: rows.length, hidden: 0, tail: '' }
  if (expanded || rows.length <= PREVIEW_ROWS) return whole
  const tail = pinned !== '' && text.endsWith(pinned) ? pinned : ''
  const tailRows = tail === '' ? 0 : wrapLines(tail, width).length
  const hidden = rows.length - PREVIEW_ROWS - tailRows
  // The count is a row of its own, so holding back one row saves nothing and
  // costs the reader the line it was hiding.
  if (hidden <= 1) return whole
  return { head: rows.slice(0, PREVIEW_ROWS).join('\n'), rows: PREVIEW_ROWS + tailRows, hidden, tail }
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

/**
 * The one thing a command here does that cannot be undone: take a credential
 * off disk. `/<venue> disconnect`, `/<source> disconnect` and `/forget <venue>`
 * are the three spellings of it, and every one of them is one press away — a
 * row under each connected venue in `/`, a runnable entry in ctrl+s, and a
 * single left-click on either.
 */
function forgets(parsed: ParsedCommand): { venue: string; ref?: string; all: boolean } | null {
  // `/forget <venue>` is the spelling that means everything stored for it,
  // however many accounts that is. `/<venue> disconnect` takes one, and asks
  // which where there is more than one to mean.
  if (parsed.name === 'forget') return parsed.args[0] ? { venue: parsed.args[0], all: true } : null
  if (parsed.args[0] === 'disconnect') {
    // `/wallet disconnect vault` names one of a set, and the question has to
    // name the same one — a confirmation about "the address" over a venue
    // holding three is a deletion nobody could check before agreeing to it.
    const ref = parsed.args[1]
    return ref ? { venue: parsed.name, ref, all: false } : { venue: parsed.name, all: false }
  }
  return null
}

/**
 * The end of a command's output that the transcript may not hold back.
 *
 * The command hands over the block it appended, so the same *call* that wrote
 * it says where it starts — no reading for the word `INCOMPLETE`, which would
 * be a second copy of a sentence commands.ts owns, and no second call to
 * `incompleteNote`, which answers a shorter thing once a session has been
 * given the REMOVED explanation and would then name a tail this output does
 * not end with. A command that reports its failures inside the table instead
 * (`/venues`) hands over nothing but a price source's failure; handing over
 * nothing pins the whole of it, and none of it is truncated.
 */
function caveat(result: { output: string; note?: string; incomplete?: boolean }): string | undefined {
  if (!result.incomplete) return undefined
  return result.note !== undefined && result.note !== '' ? result.note : result.output
}

/** A chunk that came in beside a mouse report carries no modifier of its own. */
const TEXT_ONLY: ShellKey = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  home: false,
  end: false,
  shift: false,
  return: false,
  escape: false,
  ctrl: false,
  meta: false,
  tab: false,
  backspace: false,
  delete: false,
}

/** C0 controls but tab and a line break: the ctrl chords Ink leaves inside a read of text. */
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/
const PIECES = /(\r\n|\r|\n|[\x00-\x08\x0b\x0c\x0e-\x1f])/

/** One piece of a read Ink handed over whole, as the key Ink hands over when it arrives alone. */
function pressed(piece: string): [string, ShellKey] {
  if (/^[\r\n]+$/.test(piece)) return ['\r', { ...TEXT_ONLY, return: true }]
  const code = piece.length === 1 ? piece.charCodeAt(0) : -1
  if (code === 0x08) return ['', { ...TEXT_ONLY, backspace: true }]
  if (code >= 1 && code <= 26) return [String.fromCharCode(code + 96), { ...TEXT_ONLY, ctrl: true }]
  return [piece, TEXT_ONLY]
}

/**
 * What is left of a chunk once its mouse reports are taken out, as typed text.
 * An escape sequence that shared the chunk is dropped rather than typed: half
 * an arrow key on the line is worse than an arrow key that did not arrive.
 */
function alsoTyped(rest: string): string {
  if (rest.includes('\x1b')) return ''
  return rest.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

/**
 * A ctrl+r search in progress: what has been typed, the history entry it has
 * landed on (-1 before anything has), and the line as it stood, which ctrl+g
 * and ctrl+c put back.
 */
interface Search {
  query: string
  at: number
  original: LineEditor
}

/**
 * A pending credential deletion, and the word that runs it.
 *
 * Not Enter, and not a single letter. Enter is the key that arrived here, and
 * the menu already teaches that a press which changes nothing on screen was a
 * press that missed — so an overshoot answered by pressing Enter again would
 * be the same defect with a sentence in front of it. A stray character is what
 * a hand resting on a trackpad produces. Typing the name of what is about to
 * be forgotten cannot be reached by either, and it settles *which* venue is
 * being forgotten, which is the thing an overshoot got wrong.
 */
interface Forget {
  /** The command to run once the name has been typed. */
  line: string
  /** What has to be typed: the id of the venue or price source. */
  word: string
  /** For the line under the input, which stays up while the name is typed. */
  label: string
  /** What was being typed when a queued command raised the question, put back once it is answered. */
  draft: string
}

/** A load's step, in the voice the tool labels are written in. */
function loadLabel(step: LoadStep): string {
  return step.kind === 'venue'
    ? `reading ${step.venue}${step.account ? ` (${step.account})` : ''}`
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

/** Wrapped here rather than by Ink, so `trimTop` can cut it by rows. */
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
  pinned,
}: {
  kind: EntryKind
  text: string
  width: number
  expanded: boolean
  dim: boolean
  trimTop: number
  pinned: string | undefined
}) {
  const { head, hidden, tail } = preview(text, width, expanded, pinned)
  const cut = trimTop > 0 ? wrapLines(head, width).slice(trimTop).join('\n') : head
  return (
    <Box marginBottom={1} paddingLeft={OUTPUT_INDENT} flexDirection="column">
      <Line kind={kind} text={cut} dim={dim} />
      {hidden > 0 && (
        // The way out belongs where the dead end is, not in a help screen.
        <Text dimColor>{`… ${hidden} more line${hidden === 1 ? '' : 's'} · ctrl+o`}</Text>
      )}
      {tail !== '' && <Line kind={kind} text={tail} dim={dim} />}
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
      pinned={entry.pinned}
    />
  )
}

/** What `TranscriptEntry` will occupy, so the copy can be cut to the rows it has. */
function entryRows(entry: Entry, width: number, expanded: boolean): number {
  // A question can run over several lines, and a height that disagrees with
  // what was drawn clips the backdrop by the difference.
  if (entry.kind === 'prompt') return wrapLines(entry.text, width + OUTPUT_INDENT - 2).length + 1
  const { rows, hidden } = preview(entry.text, width, expanded, entry.pinned)
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
  /** The candidates for the argument the cursor is in. `empty` says why there are none. */
  | { level: 'args'; heading: string; empty?: string }
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
   * Ask the terminal whether it speaks the kitty keyboard protocol, and turn it
   * on when it answers. Set by `run.tsx`; the emulator in the tests answers
   * nothing unless a test says it does.
   */
  keyboardProtocol?: boolean
  /**
   * Injected in tests; never in the product, which builds one from whatever
   * credential it found. A screen with an answer half-written on it is a frame
   * only a model in mid-turn produces, and the real one cannot be held there.
   */
  agent?: Agent
}

export function App({
  session,
  connectors,
  initialApiKey,
  initialVenues,
  agent: given,
  keyboardProtocol = false,
}: Props) {
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
  // The input box's side padding and its `❯ ` come out of the frame.
  const textWidth = Math.max(10, frameWidth - 4)

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
  /**
   * What the venue being connected already holds, read as the screen opens. The
   * flow needs it to ask add-or-replace, and reading it there rather than
   * inside the component keeps the component a screen over data it was handed.
   */
  const [connectExisting, setConnectExisting] = useState<secrets.StoredCredential[]>([])
  // Set only while a price source is being keyed, so onDone knows to activate it.
  const [pendingPrice, setPendingPrice] = useState<string | null>(null)
  const [activePrice, setActivePrice] = useState<string>(DEFAULT_PROVIDER)
  const [connected, setConnected] = useState<string[]>(initialVenues)
  /** The store as it was at start, split the one way every count here splits it. */
  const opening = useMemo(
    () => storedVenues(initialVenues, connectors.keys()),
    [initialVenues, connectors],
  )

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
        // `v` because that is how the tag, the release and every `git` and `npm`
        // line about this build spell it; the bare number was the odd one out.
        `tula v${APP_VERSION}`,
        APP_DESCRIPTION,
        // Where the shell was opened. tula reads nothing from it — the book is
        // the same in any directory — but it is what tells two terminals apart
        // at a glance, and every other tool in one prints it.
        homeRelative(process.cwd()),
        // What this build reads, not what is on disk. Naming a venue tula has
        // dropped as connected is contradicted by the REMOVED block the same
        // screen prints below it, and the reader has no way to tell which of
        // the two is the one that is out of date.
        ...(opening.read.length > 0 ? [`Connected: ${opening.read.join(', ')}`] : []),
        // Said, because the credential is still theirs and still on disk — and
        // said with the way out, because nothing else on the opening screen is
        // going to mention it until a command reads the store.
        ...opening.removed.map(
          (id) => `Removed: ${id} — tula no longer reads it. ${forgetCommand(id)}`,
        ),
      ].join('\n'),
    }),
    [opening],
  )
  const [editor, commitEditor] = useState<LineEditor>(() => lineEditor())
  /**
   * `editor`, as the last key left it. Ink hands over every key of one read
   * before a render, and each reading state edits the line from before the
   * first: `abc`, backspace and Enter sent an empty line.
   */
  const editorNow = useRef(editor)
  const setEditor = useCallback((next: LineEditor | ((ed: LineEditor) => LineEditor)) => {
    editorNow.current = typeof next === 'function' ? next(editorNow.current) : next
    commitEditor(editorNow.current)
  }, [])
  const input = editor.text
  const cursor = editor.cursor
  const [busy, setBusy] = useState(false)
  /**
   * `busy`, readable in the same tick it changes. Two Enters that land before a
   * render would otherwise both find nothing running, and the second line
   * would run beside the first instead of after it.
   */
  const busyNow = useRef(false)
  const setWorking = useCallback((on: boolean) => {
    busyNow.current = on
    setBusy(on)
  }, [])
  /** Lines submitted while something ran, oldest first. Each runs once, after the one before it. */
  const [queue, commitQueue] = useState<string[]>([])
  /** `queue`, readable in the same tick it changes, for the reason `busyNow` is. */
  const queueNow = useRef<string[]>([])
  const setQueue = useCallback((next: string[]) => {
    queueNow.current = next
    commitQueue(next)
  }, [])
  /** Aborts the question being answered; null while none is. */
  const stopper = useRef<AbortController | null>(null)
  const runningCommand = useRef(false)
  /** Said on the busy row when a stop is asked of something that cannot stop. */
  const [stopNote, setStopNote] = useState('')
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
  const [palette, setPalette] = useState<{
    query: LineEditor
    index: number
    offset: number
  } | null>(null)
  // Whole-transcript rather than per-entry, and it outlives the entry it was
  // turned on for: after reading "18 more lines" you usually want the answer
  // above it whole too, and the next one as well.
  const [expanded, setExpanded] = useState(false)
  const [forgetting, setForgetting] = useState<Forget | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const historyIndex = useRef(-1)
  const [search, setSearch] = useState<Search | null>(null)
  /** The `?` panel: every key, above the input, until a key closes it. */
  const [keysOpen, setKeysOpen] = useState(false)
  /** Null while vim editing is off, which it is until somebody turns it on. */
  const [vim, commitVim] = useState<VimState | null>(null)
  /** `vim`, as the last key left it, for the reason `editorNow` is: `dw` then `.` in one read repeated nothing. */
  const vimNow = useRef<VimState | null>(null)
  const setVim = useCallback(
    (next: VimState | null | ((v: VimState | null) => VimState | null)) => {
      vimNow.current = typeof next === 'function' ? next(vimNow.current) : next
      commitVim(vimNow.current)
    },
    [],
  )
  const nextId = useRef(0)

  useEffect(() => {
    let live = true
    void readPreferences().then((prefs) => {
      if (live && prefs.vim) setVim(vimState())
    })
    return () => {
      live = false
    }
  }, [])

  const push = useCallback((kind: EntryKind, text: string, pinned?: string) => {
    setEntries((prev) => [
      ...prev,
      { id: nextId.current++, kind, text, ...(pinned ? { pinned } : {}) },
    ])
  }, [])

  /**
   * Said once. A refused history file is a command to run, and repeating it
   * under every line typed afterwards is nagging about a thing already said.
   */
  const historyRefused = useRef(false)
  const refuseHistory = useCallback(
    (err: unknown) => {
      if (historyRefused.current) return
      historyRefused.current = true
      push('error', `${failureText(err)}\n  Until then, ↑ recalls this session's lines and nothing is saved.`)
    },
    [push],
  )

  /**
   * Writes in the order lines were submitted. `/history clear` waits on it, or
   * the append for the line that asked could land after the file was removed.
   */
  const recording = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let live = true
    readHistory().then((saved) => {
      if (live) setHistory((typed) => [...saved, ...typed])
    }, refuseHistory)
    return () => {
      live = false
    }
  }, [refuseHistory])

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
      // The two reads are inside it too. `store.load()` throws by design on a
      // store whose mode drifted, one reached through a symlink, or one a newer
      // build wrote — the refusals it exists to make — and left outside the
      // catch those became an unhandled rejection at the moment somebody had
      // just signed in, with the sentence explaining why never drawn.
      let source: Awaited<ReturnType<typeof credentialSource>>
      let key: string | undefined
      try {
        if (result.kind === 'key') await secrets.putProviderKey(result.apiKey)
        if (result.kind === 'signed-out') await secrets.removeProviderKey()
        source = await credentialSource()
        key = envApiKey() ?? (await secrets.getProviderKey())
      } catch (err) {
        return push('error', failureText(err))
      }
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
    // A store this cannot read is not a store with no price source in it: the
    // read throws, and unhandled it takes the shell down before it has drawn.
    void secrets
      .getPriceSource()
      .then((stored) => setActivePrice(stored?.provider ?? DEFAULT_PROVIDER))
      .catch((err: unknown) => push('error', failureText(err)))
  }, [push])

  const prices: PriceEntry[] = useMemo(() => priceEntries(activePrice), [activePrice])

  /**
   * What each venue holds, named the way `/<venue> disconnect <name>` takes it
   * back. Read when that argument is reached rather than at start, and dropped
   * whenever the store changes, so a list never offers an entry already gone.
   */
  const [accounts, setAccounts] = useState<Record<string, Candidate[]>>({})
  useEffect(() => setAccounts({}), [connected])
  const accountsFor = /^\/(\S+) disconnect /i.exec(input)?.[1]?.toLowerCase()
  useEffect(() => {
    if (!accountsFor || accounts[accountsFor] || !connected.includes(accountsFor)) return
    let live = true
    secrets
      .listCredentials(accountsFor)
      .then((held) => {
        if (!live) return
        const named = held.map((e) => ({
          name: secrets.credentialRef(e),
          summary: secrets.credentialLabel(e),
        }))
        setAccounts((known) => ({ ...known, [accountsFor]: named }))
      })
      // A store that cannot be read offers nothing here; the command itself
      // reports the refusal, with its remedy, when it is run.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [accountsFor, accounts, connected])

  const candidates: CandidateContext = useMemo(() => {
    const { positions } = session.current
    const held = new Map<string, Set<string>>()
    for (const p of positions) {
      const asset = p.asset.toUpperCase()
      held.set(asset, (held.get(asset) ?? new Set()).add(p.venue))
    }
    return {
      venues: venueEntries,
      stored: connected.map((id) => ({
        name: id,
        summary:
          venueEntries.find((v) => v.id === id)?.detail ??
          'no longer read by this build — forgetting it removes the key',
      })),
      assets: session.isLoaded
        ? [...held]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, venues]) => ({ name, summary: `held at ${sentenceList([...venues])}` }))
        : null,
      accounts: (venue) => accounts[venue] ?? null,
    }
  }, [session, venueEntries, connected, accounts, entries.length])

  const menu: Menu | null = useMemo(() => {
    // Nothing runs off the menu while a credential is waiting to be named, and
    // a list of commands over a question is a list that answers a different one.
    // A command is one line, so a text holding a break is a question.
    if (!input.startsWith('/') || input.includes('\n') || menuDismissed || forgetting || search) return null
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

    const args = argumentList(input, candidates)
    if (args) {
      const unfiltered = argumentList(args.prefix, candidates)?.candidates.length ?? 0
      return {
        level: 'args',
        items: args.candidates.map((c) => ({ name: c.name, summary: c.summary })),
        prefix: args.prefix,
        heading: args.heading,
        ...(args.empty ? { empty: args.empty } : {}),
        total: Math.max(1, unfiltered),
      }
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
  }, [input, menuDismissed, forgetting, search, venueEntries, prices, connectors, candidates])

  /**
   * A different line rather than an edit to this one, so its undo starts
   * empty — Readline's "separately remembered for each line". The kill buffer
   * is the process's, and outlives the line it was filled on.
   */
  const setLine = useCallback((value: string, at = value.length) => {
    setEditor((ed) => ({ ...lineEditor(value, { killed: ed.killed }), cursor: at }))
    setMenuDismissed(false)
    setMenuIndex(0)
    setMenuOffset(0)
  }, [])

  /** An edit to the line. The menu is re-derived only when the text changed, not the cursor. */
  const changeLine = (next: LineEditor) => {
    const changed = next.text !== editorNow.current.text
    setEditor(next)
    if (!changed) return
    setMenuDismissed(false)
    setMenuIndex(0)
    setMenuOffset(0)
  }

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
    // The venues the user connected that this build reads — the same split the
    // banner names, so the two can no longer state different numbers about one
    // store. Counted off the store rather than off the rows: one Aave address
    // holding positions in three of its markets is one venue, and a venue that
    // answered with nothing is still one that is connected.
    const { read, removed } = storedVenues(connected, connectors.keys())
    const stalest = session.stalest()
    const parts = [
      `${read.length} venue${read.length === 1 ? '' : 's'}`,
      `${positions.length} position${positions.length === 1 ? '' : 's'}`,
    ]
    if (stalest) parts.push(freshness(stalest))
    // Removed, failed and never-asked are three different things. Counting a
    // venue this build dropped among the failures reported an outage about a
    // venue nothing was asked of, eight lines under a block saying so.
    // By venue, and a venue that answered in part is not one that failed.
    const failed = new Set(failures.map(failedVenue).filter((v) => !removed.includes(v)))
    const partial = answeredInPart(session.current).length
    if (failed.size > partial) parts.push(`${failed.size - partial} failed`)
    if (partial > 0) parts.push(`${partial} partial`)
    if (removed.length > 0) parts.push(`${removed.length} removed`)
    parts.push(agent ? 'opus 5' : 'commands only')
    return parts.join('  ·  ')
  }, [session, agent, entries.length, streaming, connected, connectors, tick])

  /**
   * Says what is about to be forgotten and what it would take to get it back,
   * then waits for the name to be typed. The question goes into the transcript
   * rather than into a dialog: it is a step in the command that was asked for,
   * it is traceable there afterwards, and a floating panel is a redraw of the
   * whole screen for a sentence and a word.
   */
  const askToForget = useCallback(
    async (line: string, id: string, ref: string | undefined, all: boolean): Promise<boolean> => {
      const connector = connectors.get(id)
      const provider = priceProvider(id)
      const name = connector?.venue.name ?? provider?.name ?? id
      const lines = [`Forget ${name}?`]

      if (provider) {
        const stored = await secrets.getPriceSource()
        // Nothing on disk is nothing to lose, and a question about a key that
        // does not exist is a question nobody can answer. The command itself
        // says so better than a confirmation could.
        if (stored?.provider !== id || !stored.apiKey) return false
        const fallback = priceProvider(DEFAULT_PROVIDER)?.name ?? DEFAULT_PROVIDER
        lines.push(
          `  tula deletes the ${name} API key from ${secrets.locationHint()} and prices`,
          `  every figure from ${fallback} again.`,
        )
      } else {
        // A store that cannot be read is a store that may well hold this: the
        // question is asked, rather than a deletion running on the assumption.
        let stored: secrets.StoredCredential[] = []
        let named: secrets.StoredCredential | undefined
        let read = true
        try {
          stored = await secrets.listCredentials(id)
          if (ref) named = await secrets.findCredential(id, ref)
        } catch {
          read = false
        }
        if (read && stored.length === 0) return false
        // A ref that matches nothing deletes nothing, so there is nothing to
        // confirm: the command itself answers, naming what the venue does hold.
        if (ref && read && !named) return false
        // Neither does `/<venue> disconnect` over a venue holding several,
        // which asks which one instead of guessing. Confirming a deletion and
        // then being told to pick one is a gate that taught nothing and cost a
        // typed word — and the next thing it teaches is to type it faster.
        if (!ref && !all && stored.length > 1) return false

        // Everything stored, or the one entry the command named — and the
        // question says which, because "3 addresses" and "this one of 3" are
        // different deletions and the reader agrees to exactly one of them.
        const shown = (named ? [named] : stored).map((e) => secrets.credentialLabel(e))
        const kept = stored.length - shown.length

        const addressOnly = connector?.fields.every((f) => !f.secret) ?? false
        if (connector && addressOnly) {
          // An address is public, and it is the whole of what is stored, so it
          // is named: that is what tells one wallet from another.
          lines.push(
            shown.length === 1
              ? `  tula forgets the address it reads ${name} from: ${shown[0]}`
              : `  tula forgets all ${shown.length} addresses it reads ${name} from: ${shown.join(', ')}`,
            ...(kept > 0 ? [`  The other ${kept} stay, and so do their positions.`] : []),
            '  Reconnecting takes the same address again — nothing else is lost.',
          )
        } else if (connector) {
          lines.push(
            shown.length === 1 && stored.length === 1
              ? `  tula deletes the read-only ${name} key from ${secrets.locationHint()}.`
              : `  tula deletes ${shown.length} of ${name}'s read-only keys from ${secrets.locationHint()}: ${shown.join(', ')}`,
            ...(kept > 0 ? [`  The other ${kept} stay, and so do their positions.`] : []),
            '  An exchange shows a secret key once, when it is created, so the way',
            '  back is to make a new one there — not to undo this.',
          )
        } else {
          lines.push(`  tula deletes what is stored for ${id}, from ${secrets.locationHint()}.`)
        }
      }

      lines.push('', `  Type ${id} and press Enter to confirm, or Esc to keep it.`)
      push('notice', lines.join('\n'))
      // The question says to type a name, so the next letters type. In NORMAL
      // they would be commands, and `kraken` would walk history and append.
      setVim((v) => (v ? { ...v, mode: 'insert', pending: '' } : v))
      // A line typed from the prompt is not the name, so a draft typed while
      // this command waited in the queue is set aside rather than compared.
      const draft = editorNow.current.text
      if (draft) setLine('')
      setForgetting({ line, word: id, label: name, draft })
      return true
    },
    [connectors, push, setLine],
  )

  /** Enter with anything else on the line keeps the credential, and says so. */
  const keepCredential = useCallback(() => {
    if (!forgetting) return
    push(
      'notice',
      `Kept ${forgetting.label} — nothing was deleted.\n` +
        `  Run ${forgetting.line} again if you did mean to forget it.`,
    )
    setForgetting(null)
    setLine(forgetting.draft)
  }, [forgetting, push, setLine])

  /** `/history`, and `/history clear`. */
  const historyCommand = useCallback(
    async (args: string[]): Promise<{ output: string; error?: boolean }> => {
      const where = homeRelative(historyPath())
      if (args[0] === 'clear') {
        await recording.current
        const held = await clearHistory()
        setHistory([])
        historyIndex.current = -1
        return {
          output:
            held === 0
              ? `Nothing to clear — ${where} holds no history.`
              : `Cleared ${held} line${held === 1 ? '' : 's'} from ${where}. ↑ starts empty.`,
        }
      }
      if (args.length > 0) {
        return { output: `/history takes clear or nothing. Try: /history clear`, error: true }
      }
      if (historyOff()) {
        return {
          output:
            'Nothing is saved: TULA_NO_HISTORY=1 is set.\n' +
            "  ↑ and ctrl+r reach this session's lines, and they go when tula closes.",
        }
      }
      const saved = (await readHistory()).length
      return {
        output: [
          `${saved} line${saved === 1 ? '' : 's'} to recall from ${where}, readable by you alone.`,
          `  ↑ and ctrl+r reach the newest ${HISTORY_LIMIT}, and older lines leave the file as it grows.`,
          '  A line typed with a space in front is not kept, and neither is anything shaped like',
          '  a key, or anything typed while connecting a venue.',
          '  /history clear empties it  ·  TULA_NO_HISTORY=1 keeps nothing',
        ].join('\n'),
      }
    },
    [],
  )

  const submit = useCallback(
    async (line: string, confirmed = false, from: 'line' | 'queue' = 'line') => {
      const trimmed = line.trim()
      // A confirmed command was echoed and recorded when it was first asked
      // for; running it again is the same command, not a second one.
      // Refused before the line is cleared, so what was typed is still there
      // to put back on one line.
      if (!confirmed && trimmed.startsWith('/') && trimmed.includes('\n')) {
        const lines = trimmed.split('\n').length
        push(
          'error',
          `A command takes one line, and this one runs over ${lines}.\n` +
            '  ctrl+k at the end of a line takes the break after it — or drop the slash to ask it as a question.',
        )
        return
      }
      // Queued rather than run beside what is running, or ahead of a queue not
      // yet started, and said on screen by the queue drawn above the input.
      // Echoed and recorded when it runs — whole, so a space in front still
      // keeps it out of history.
      if (!confirmed && from === 'line' && (busyNow.current || queueNow.current.length > 0)) {
        setLine('')
        historyIndex.current = -1
        if (trimmed) setQueue([...queueNow.current, line])
        return
      }
      if (!confirmed) {
        // A queued line starts while somebody may be typing the next one, and
        // that draft is not this line's to clear.
        if (from === 'line') {
          setLine('')
          historyIndex.current = -1
        }
        if (!trimmed) return
        // Not even this session's list: bash's `ignorespace` keeps the line out
        // of history altogether, and a pasted key recalled with ↑ is a key on
        // screen a second time.
        if (recordable(line)) {
          setHistory((prev) => (prev.at(-1) === trimmed ? prev : [...prev, trimmed]))
          recording.current = recording.current.then(() => recordHistory(line)).catch(refuseHistory)
        }
        push('prompt', `❯ ${trimmed.replace(/\n/g, '\n  ')}`)
      }
      setWorking(true)

      try {
        const parsed = parseCommand(trimmed, [...connectors.keys()])
        if (parsed && !confirmed) {
          const target = forgets(parsed)
          if (target && (await askToForget(trimmed, target.venue, target.ref, target.all))) return
        }
        if (parsed) {
          runningCommand.current = true
          const result = await dispatchCommand(
            session,
            connectors,
            parsed,
            venueEntries,
            // `/update install` pulls tens of megabytes. Without a label the
            // spinner reads `working` for the whole of it, which is the hang
            // `install.sh` used to look like before it kept curl's meter.
            (received, total) => setActivity(downloaded(received, total)),
          )
          if (result.kind === 'connect') {
            const connector = connectors.get(result.venue)
            if (!connector) return
            setConnectExisting(await secrets.listCredentials(result.venue))
            return setConnecting(connectable(connector))
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
            if (result.action === 'history') {
              const said = await historyCommand(parsed.args)
              return push(said.error ? 'error' : 'output', said.output)
            }
            if (result.action === 'vim') {
              const on = vimNow.current === null
              setVim(on ? vimState() : null)
              try {
                await writePreferences({ vim: on })
              } catch (err) {
                return push(
                  'error',
                  `${failureText(err)}\n  Vim editing is ${on ? 'on' : 'off'} for this session only.`,
                )
              }
              return push(
                'output',
                on
                  ? 'Vim editing is on, and stays on in later sessions.\n' +
                      '  Esc for NORMAL, i to type again  ·  /vim turns it off'
                  : 'Vim editing is off, and every key is the line’s own again.  /vim turns it back on',
              )
            }
          } else {
            push('output', result.output, caveat(result))
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
          const controller = new AbortController()
          stopper.current = controller
          try {
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
          }, controller.signal)
          } catch (err) {
            if (!(err instanceof StoppedError)) throw err
            // What already arrived stays where it was read, and the line under
            // it says the model will not see it — `ask` rolled it back.
            setStreaming('')
            if (answer.trim()) push('answer', answer.trim())
            push('notice', 'Stopped. That question and what came of it are left out of the conversation.')
            return
          }
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
        push('error', failureText(err))
      } finally {
        stopper.current = null
        runningCommand.current = false
        setStopNote('')
        setActivity('')
        setWorking(false)
      }
    },
    [
      session,
      connectors,
      agent,
      exit,
      push,
      setLine,
      venueEntries,
      refreshConnected,
      askToForget,
      refuseHistory,
      historyCommand,
      setVim,
    ],
  )

  // The refs as well as the render, so what started or queued since the last
  // commit decides, however late React runs this.
  useEffect(() => {
    if (busy || busyNow.current || forgetting || connecting || credentials) return
    const [next, ...rest] = queueNow.current
    if (next === undefined) return
    setQueue(rest)
    void submit(next, false, 'queue')
  }, [busy, forgetting, connecting, credentials, queue, submit, setQueue])

  /**
   * Stops what is running, where that is a question. A command is left to end:
   * its reads carry their own deadline and no signal reaches them, so the busy
   * row says that rather than the press doing nothing on screen.
   */
  const stop = useCallback(() => {
    if (stopper.current) {
      stopper.current.abort()
      setActivity('stopping')
      return
    }
    if (runningCommand.current || busyNow.current) {
      setStopNote('a command is not stopped — each read ends at its deadline')
    }
  }, [])

  /**
   * Enter while a credential is waiting to be named. Anything but the name
   * keeps it — an empty line included, which is what a second Enter after an
   * overshoot is.
   */
  const confirmForget = useCallback(
    (candidate: string) => {
      if (!forgetting) return
      if (candidate.trim().toLowerCase() !== forgetting.word) return keepCredential()
      const { line, draft } = forgetting
      setForgetting(null)
      setLine(draft)
      void submit(line, true)
    },
    [forgetting, keepCredential, setLine, submit],
  )

  /**
   * Opening the session should answer the question the session exists for. The
   * command is echoed rather than run invisibly, so the state on screen is
   * always traceable to something the user could have typed.
   */
  const showState = useCallback(async () => {
    const parsed = parseCommand('/exposure')
    if (!parsed) return
    setWorking(true)
    runningCommand.current = true
    try {
      push('prompt', '❯ /exposure')
      const result = await dispatchCommand(session, connectors, parsed, venueEntries)
      if (result.kind === 'output') push('output', result.output, caveat(result))
    } catch (err) {
      push('error', failureText(err))
    } finally {
      runningCommand.current = false
      setStopNote('')
      setWorking(false)
    }
  }, [session, connectors, venueEntries, push, setWorking])

  /** The front of a mouse report that arrived without its end. */
  const mouseCarry = useRef('')

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
   * still lands on the line with the cursor where the first one goes, as in ctrl+s.
   */
  const runFromMenu = useCallback(
    (at = menuIndex) => {
      if (!menu) return
      const chosen = menu.items[at]
      // A candidate inside the line is inserted and the list closed; the next
      // Enter runs the line. fish's pager and zsh's `complist` both keep that
      // split — the sources are in tasks/field-report/09-argument-completion.md.
      if (menu.level === 'args') {
        const line = editorNow.current.text
        // A candidate already typed out whole has nothing left to insert, and an
        // Enter that changes nothing on screen reads as a key that missed.
        const whole = chosen && line.trimEnd().toLowerCase() === `${menu.prefix}${chosen.name}`.toLowerCase()
        if (!chosen || whole) return void submit(line)
        setLine(`${menu.prefix}${chosen.name} `)
        return setMenuDismissed(true)
      }
      if (!chosen) return
      // Bracketed arguments are optional, so the command runs without them, as
      // Claude Code runs one. Completing instead made `/update` three Enters from
      // `/update install`.
      if (chosen.args && !chosen.args.startsWith('[')) return completeFromMenu(at)
      void submit(`${menu.prefix}${chosen.name}`)
    },
    [menu, menuIndex, completeFromMenu, submit, setLine],
  )

  /**
   * The line as it stood when ↑ first left it, put back when ↓ comes past the
   * newest entry — Readline saves it the same way. A question three lines long
   * is not something to lose to one arrow too many.
   */
  const draft = useRef('')

  const recallHistory = useCallback(
    (direction: -1 | 1) => {
      if (history.length === 0) return
      if (historyIndex.current === -1 && direction === 1) return
      if (historyIndex.current === -1) draft.current = editorNow.current.text
      const current = historyIndex.current === -1 ? history.length : historyIndex.current
      const next = Math.min(history.length, Math.max(0, current + direction))
      historyIndex.current = next === history.length ? -1 : next
      setLine(next === history.length ? draft.current : (history[next] ?? ''))
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
        (e) => e.kind !== 'prompt' && preview(e.text, bodyWidth, false, e.pinned).hidden > 0,
      ),
    [entries, bodyWidth],
  )

  const paletteItems = useMemo(
    () => buildPalette(venueEntries, prices),
    [venueEntries, prices],
  )
  const paletteMatches = useMemo(
    () => (palette ? matchPalette(palette.query.text, paletteItems) : []),
    [palette, paletteItems],
  )
  // The rows the dialog will draw, measured here too: scrolling counts in those
  // rather than in matches, and the two have to agree on where the window is.
  const paletteRows = useMemo(
    () => (palette ? displayRows(paletteMatches, palette.query.text) : []),
    [palette, paletteMatches],
  )
  const paletteLimit = windowRows(viewport.rows)

  // Fixed, so filtering never resizes the block under the input line, but no
  // taller than the menu can fill or than the frame can afford: the input box,
  // the trailing count and the status line all come out of the same viewport —
  // and one more row of it while the expanded hint is up.
  const inputRows = Math.min(INPUT_ROWS, visualRows(input, textWidth).length)
  // The busy row and the queue sit in the frame too, since a list can be
  // open while something runs.
  const workRows =
    (busy ? 2 : 0) +
    (queue.length > 0 ? 2 + Math.min(queue.length, QUEUE_ROWS) + (queue.length > QUEUE_ROWS ? 1 : 0) : 0)
  const menuRows = Math.max(
    4,
    Math.min(rows - 8 - (inputRows - 1) - (expanded ? 1 : 0) - workRows, menu?.total ?? 0),
  )

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
    const { text, killed } = editorNow.current
    setPalette({
      query: lineEditor(text.replace(/^\//, ''), { killed }),
      index: 0,
      offset: 0,
    })
  }, [stdout])

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
   * Asked again whenever the frame under the open menu can have moved, rather
   * than once when it opens: a line that wraps makes the input box a row
   * taller, and output, the busy row, the queue and a streaming answer land
   * and leave while the menu stays up.
   */
  useEffect(() => {
    if (!menuOpen || !stdout) return setAnchor(null)
    askCursor(stdout)
  }, [menuOpen, stdout, input, viewport, entries.length, busy, queue.length, keysOpen, streaming, generation])

  /**
   * The rest of a line, suggested after the cursor: the newest history entry
   * that starts with what is typed, then the highlighted candidate of an open
   * list — zsh-autosuggestions' `(history completion)` order. History is only
   * what `recordable` let in, so nothing typed while connecting a venue can
   * surface here, and no line the deletion prompt owns gets one.
   */
  const suggestion = (text: string, at: number): string => {
    if (forgetting || search || palette || text === '' || at !== text.length) return ''
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i] ?? ''
      if (entry.length > text.length && entry.startsWith(text)) {
        const rest = entry.slice(text.length).split('\n')[0] ?? ''
        if (rest) return rest
      }
    }
    const chosen = menu?.items[menuIndex]
    const full = chosen && menu ? `${menu.prefix}${chosen.name}` : ''
    return full.length > text.length && full.startsWith(text) ? full.slice(text.length) : ''
  }
  const ghost = suggestion(input, cursor)

  /** What ctrl+r is showing: the entry it landed on, or the line it started from. */
  const searched = search
    ? search.at >= 0
      ? (history[search.at] ?? '')
      : search.original.text
    : ''
  const searchMatches = search !== null && search.at >= 0 && searched.includes(search.query)

  const cancelSearch = () => {
    if (!search) return
    setEditor(search.original)
    setSearch(null)
  }

  /**
   * The match becomes the line, and ↑ carries on from where it sits. The menu
   * stays down for the reason `recallHistory` gives.
   */
  const takeSearch = (): LineEditor => {
    const taken = lineEditor(searched, { killed: editorNow.current.killed })
    historyIndex.current = search && search.at >= 0 ? search.at : -1
    setSearch(null)
    setEditor(taken)
    setMenuDismissed(true)
    return taken
  }

  /**
   * ctrl+r's keys, from `tasks/field-report/08-saved-history.md`: Enter runs
   * the match, Esc and Tab put it on the line, ctrl+g and ctrl+c put the line
   * back as it was, and any other editing key takes the match and then does
   * what it does — Readline's "a movement command will terminate the search".
   */
  const onSearchKey = (ch: string, key: ShellKey): void => {
    if (!search) return
    const command = editingCommand(ch, key)
    const step = (direction: -1 | 1) => {
      if (search.query === '') return
      const from =
        search.at >= 0 ? search.at + direction : direction < 0 ? history.length - 1 : history.length
      const at = findInHistory(history, search.query, from, direction, searched)
      if (at >= 0) setSearch({ ...search, at })
    }

    if (key.ctrl && ch === 'g') return cancelSearch()
    if (key.return) {
      setSearch(null)
      return void submit(searched)
    }
    if (key.escape || key.tab) return void takeSearch()
    if (command === 'reverse-search-history' || command === 'previous-history') return step(-1)
    if (command === 'forward-search-history' || command === 'next-history') return step(1)
    if (command === 'backward-delete-char') {
      const query = search.query.slice(0, before(search.query, search.query.length))
      const at = query === '' ? -1 : findInHistory(history, query, history.length - 1, -1)
      return setSearch({ ...search, query, at: at >= 0 || query === '' ? at : search.at })
    }
    if (command && isLineCommand(command)) return changeLine(edit(takeSearch(), command))
    if (key.ctrl || key.meta || !ch) return

    const { text, submits } = typed(ch)
    const query = search.query + text
    const at = findInHistory(history, query, search.at >= 0 ? search.at : history.length - 1, -1)
    // A query that stops matching keeps the last line it did match on screen,
    // as Readline's failing search does, with the row under it saying so.
    const next = { ...search, query, at: at >= 0 ? at : search.at }
    if (!submits) return setSearch(next)
    setSearch(null)
    void submit(at >= 0 ? (history[at] ?? '') : searched)
  }

  /**
   * The palette's query is a line like the shell's, sharing its kill buffer —
   * one per process, as Readline keeps it — so a word killed in one can be
   * yanked in the other.
   */
  const editQuery = (change: (query: LineEditor) => LineEditor) => {
    if (!palette) return
    const query = change(palette.query)
    if (query.killed !== editorNow.current.killed) setEditor((ed) => ({ ...ed, killed: query.killed }))
    const same = query.text === palette.query.text
    setPalette({ query, index: same ? palette.index : 0, offset: same ? palette.offset : 0 })
  }

  const onKey = (ch: string, key: ShellKey): void => {
    // Taken by the reply hook below; never a key.
    if (terminalReply(ch)) return
    // As the key before this one left them, not as this render drew them.
    const editor = editorNow.current
    const vim = vimNow.current
    const input = editor.text
    const cursor = editor.cursor
    const queue = queueNow.current
    const ghost = suggestion(input, cursor)
    // Named through the keymap, so a key handled below is a key `?` lists.
    const action = keyAction(ch, key)
    const command = editingCommand(ch, key)
    const enter = enterKey(ch, key)

    // `.` types again what INSERT recorded — text, backspace and a newline —
    // so a change made with any other key would be repeated as a different one.
    if (vim?.mode === 'insert' && vim.recording !== null) {
      const recorded =
        key.escape ||
        enter === 'newline' ||
        command === 'backward-delete-char' ||
        (command === null && enter === null && !key.ctrl && !key.meta && !key.tab)
      if (!recorded) setVim(vimUntracked(vim))
    }

    if (action === 'interrupt') {
      if (keysOpen) return setKeysOpen(false)
      if (search) return cancelSearch()
      if (palette) return setPalette(null)
      if (forgetting) return keepCredential()
      if (input.length > 0) {
        // Readline abandons the line and starts history over, so the next ↑ is
        // the newest entry again rather than the one before a recalled line.
        historyIndex.current = -1
        draft.current = ''
        return setLine('')
      }
      // Stops rather than leaves while something runs, as Codex's does, so a
      // second press meant to stop cannot end the session.
      if (busyNow.current) return stop()
      return exit()
    }
    // The palette's query and a search are lines too, where ctrl+d deletes.
    if (action === 'delete-char' && key.ctrl && input.length === 0 && !search && !palette && !busyNow.current) {
      return exit()
    }
    if (action === 'clear-screen') return clearScreen()

    // Above the busy gate on purpose: reading what an earlier command
    // returned is the natural thing to do while the next one is in flight.
    if (action === 'toggle-output') {
      setPalette(null)
      return toggleExpanded()
    }

    if (search) return onSearchKey(ch, key)

    // Esc and `?` are what close the panel. Any other key closes it and then does
    // what it does, as Gemini CLI's panel does, rather than being swallowed.
    if (keysOpen) {
      setKeysOpen(false)
      if (action === 'dismiss' || action === 'show-keys') return
    }
    // On an empty line, as Claude Code, Codex and Gemini CLI open theirs; in
    // vim NORMAL whatever is on the line, as Claude Code's does. After text,
    // `?` is a character, and in the palette's query or a deletion prompt too.
    if (
      action === 'show-keys' &&
      !palette &&
      !forgetting &&
      !menu &&
      !vim?.pending &&
      (input === '' || vim?.mode === 'normal')
    ) {
      return setKeysOpen(true)
    }

    const moves = command === 'previous-history' ? -1 : command === 'next-history' ? 1 : 0
    // A key in a form nothing here reads, which would otherwise be typed as
    // the punctuation it arrived as.
    if (enter === 'ignore') return

    // ctrl+s, because ctrl+k is Readline's kill-line:
    // `tasks/field-report/07-readline-keys.md` gives the sources. Seeded from the line, so a half-typed command becomes the
    // search rather than something to close the palette and go back to.
    if (command === 'forward-search-history') {
      if (forgetting) return
      if (palette) return setPalette(null)
      return openPalette()
    }
    if (command === 'reverse-search-history') {
      if (forgetting || palette) return
      return setSearch({ query: '', at: -1, original: editor })
    }

    // NORMAL's letters are commands on the line, and only on the line: the
    // palette's query and a deletion prompt take what is typed as text, and a
    // list moves on arrows and ctrl+n/ctrl+p alone — `j` and `k` are never
    // bound in one. Everything that is not a printable key goes on to the
    // readline keys below, in either mode.
    if (vim?.mode === 'normal' && !palette && !forgetting && ch && command === null && enter === null) {
      if (!key.ctrl && !key.meta && !key.return && !key.tab && !key.escape) {
        if (menu && (ch === 'j' || ch === 'k')) return
        const step = replay(vim, editor, ch)
        setVim(step.state)
        if (step.effect === 'previous-history' || step.effect === 'next-history') {
          return recallHistory(step.effect === 'previous-history' ? -1 : 1)
        }
        // A slash means a command in either mode, as in Codex's NORMAL.
        if (step.effect === 'open-menu') {
          setVim({ ...step.state, mode: 'insert', pending: '' })
          return setLine('/')
        }
        return changeLine(step.editor)
      }
    }

    // An Esc that a list, the palette or a prompt takes also drops a half-typed
    // NORMAL command. Nothing on screen shows a pending `d`, so keeping it
    // would let the next key delete something no frame warned about.
    if (key.escape && vim?.pending && (forgetting || palette || menu)) {
      setVim({ ...vim, pending: '' })
    }

    // The line is being used to name a credential, so the keys that would
    // put something else on it are the ones that must not fire: an arrow
    // recalling history, and Enter running whatever it recalled.
    if (forgetting) {
      if (key.escape) return keepCredential()
      if (moves !== 0 || key.tab) return
      if (key.return) return confirmForget(input)
    } else if (palette) {
      const chosen = paletteMatches[palette.index]
      if (key.escape) return setPalette(null)
      if (moves !== 0) {
        const last = paletteMatches.length - 1
        return setPalette((p) => {
          if (!p) return null
          const index = Math.max(0, Math.min(last, p.index + moves))
          return { ...p, index, offset: offsetShowing(paletteRows, paletteLimit, p.offset, index) }
        })
      }
      if (key.return || key.tab) {
        if (chosen) runFromPalette(chosen, key.tab)
        return
      }
      if (command && isLineCommand(command)) return editQuery((q) => edit(q, command))
      if (key.ctrl || key.meta || !ch) return
      const { text } = typed(ch)
      if (!text) return
      return editQuery((q) => insert(q, text))
    }

    // Taking a suggestion: whole on → ctrl+f or ctrl+e at the end of the line,
    // one word on alt+f, and on Tab where no list has anything to insert.
    // Never on Enter, which runs what is typed.
    if (ghost) {
      const whole = input + ghost
      if (
        command === 'forward-char' ||
        command === 'end-of-line' ||
        (key.tab && !(menu && menu.items.length > 0))
      ) {
        return changeLine(replace(editor, whole))
      }
      if (command === 'forward-word') {
        return changeLine(replace(editor, whole.slice(0, forwardWord(whole, cursor))))
      }
    }

    // The newline keys, on the shell's line only: a connect field, the palette's
    // query and the deletion prompt each hold one line, and Enter there is Enter.
    if (!forgetting && enter !== null) {
      if (enter === 'newline') {
        if (vim?.mode === 'insert') setVim(vimTyped(vim, '\n'))
        return changeLine(insert(editor, '\n'))
      }
      // `\` then Enter, the form every terminal can send: the backslash goes
      // and a break takes its place, as in Claude Code and Gemini CLI.
      if (!menu && cursor > 0 && input[cursor - 1] === '\\') {
        return changeLine(
          replace(editor, `${input.slice(0, cursor - 1)}\n${input.slice(cursor)}`, cursor),
        )
      }
    }

    if (menu) {
      if (moves !== 0) {
        const last = menu.items.length - 1
        const index = Math.max(0, Math.min(last, menuIndex + moves))
        setMenuIndex(index)
        return setMenuOffset((o) => offsetShowing(menuDisplayRows, menuRows, o, index))
      }
      if (key.tab && menu.items.length > 0) return completeFromMenu()
      if (key.return) return runFromMenu()
      if (key.escape) return setMenuDismissed(true)
    } else {
      // A queued line back on the line to edit: the newest, as Codex's edit key
      // takes it, on an empty line, as Gemini CLI's ↑ does. Cleared, it is gone.
      if (moves === -1 && input === '' && queue.length > 0) {
        const newest = queue.at(-1) ?? ''
        setQueue(queue.slice(0, -1))
        setLine(newest)
        return setMenuDismissed(true)
      }
      // Rows first, then history from the first and last — Claude Code and
      // Gemini CLI, and zsh's `up-line-or-history` where nothing wraps.
      if (moves !== 0) {
        const row = moveRow(editor, textWidth, moves)
        return row ? changeLine(row) : recallHistory(moves)
      }
      if (key.return) return void submit(input)
    }

    if (command && isLineCommand(command)) {
      if (vim?.mode === 'insert' && command === 'backward-delete-char') setVim(vimTyped(vim, '\x7f'))
      return changeLine(edit(editor, command))
    }
    // Esc reaches here only once no list and no deletion prompt took it, so an
    // open list keeps INSERT, as in Codex and fish. The sources, and the split
    // with Gemini CLI, are in `tasks/field-report/10-vim-mode.md`.
    // With vim on, INSERT becomes NORMAL and a half-typed command is dropped
    // before an Esc reaches what is running — Claude Code's order.
    if (key.escape && busyNow.current && !(vim && (vim.mode === 'insert' || vim.pending))) return stop()
    if (key.escape && vim) {
      const step = vimEscape(vim, editor)
      setVim(step.state)
      return changeLine(step.editor)
    }
    if (key.ctrl || key.meta || key.tab || key.escape) return
    if (!ch) return

    const { text, submits } = typed(ch)
    const next = insert(editor, text)
    if (vim?.mode === 'insert' && !submits) setVim(vimTyped(vim, text))
    // A paste carries its own newline, so it reaches Enter here rather than
    // above — including a pasted name confirming a credential deletion.
    if (submits) return forgetting ? confirmForget(next.text) : void submit(next.text)
    changeLine(next)
  }

  /**
   * The terminal's replies, taken by a hook of their own that is never
   * inactive: `/login` and a connect screen own the keyboard while they are up,
   * and a reply that arrives then is still a reply. Every other handler drops
   * what `terminalReply` recognises, so none reaches a line, a key box or
   * history, however late it comes.
   *
   * The protocol is asked about here rather than left to Ink's own detection,
   * which listens for the answer on stdin beside the reader this app mounts:
   * under Bun the two together handed one reply to the input over and over, and
   * an answer after its 200ms reached the input line as text. Asked once and
   * read here, a reply at any time turns it on, and `holdInputModes` in
   * `terminal.ts` pops what was pushed however tula leaves.
   */
  const keyboardPushed = useRef(false)
  useEffect(() => {
    if (keyboardProtocol && stdout) askKeyboard(stdout)
  }, [keyboardProtocol, stdout])
  useInput((ch) => {
    const reply = terminalReply(ch)
    if (!reply) return
    if (reply.kind === 'cursor') return setAnchor(reply.row)
    if (!keyboardProtocol || keyboardPushed.current || !stdout) return
    keyboardPushed.current = true
    stdout.write('\x1b[>1u')
  })

  /** What was typed ahead of the shell, a line or an Enter per render, so each sees the screen the last one left. */
  const [typeAhead, setTypeAhead] = useState<string[]>([])
  useEffect(() => {
    const [next, ...rest] = typeAhead
    if (next === undefined) return
    // A connect screen or /login opened by an earlier key owns the keyboard
    // now, and a key typed ahead was not typed at it: it is dropped rather than
    // put into an address field or a key box.
    if (credentials || connecting) return setTypeAhead([])
    setTypeAhead(rest)
    onKey(...pressed(next))
  }, [typeAhead, credentials, connecting])

  useInput(
    (ch, key) => {
      if (terminalReply(ch)) return
      // Before everything, including the busy gate: a report that reaches the
      // bottom of the handler is typed in as the punctuation it looks like.
      // Read as a stream rather than one report per chunk — mode 1003 reports
      // every movement, and a hand crossing the screen sends them faster than
      // stdin is drained, so they arrive several at a time and split across
      // chunk boundaries.
      const { reports, rest, partial } = mouseReports(mouseCarry.current + ch)
      mouseCarry.current = partial
      if (reports.length > 0) {
        for (const report of reports) {
          if (palette) onPaletteMouse(report)
          else onMenuMouse(report)
        }
        // What the same chunk held besides the reports is what the user typed.
        // A hand resting on the trackpad puts a movement report in front of the
        // next character, and dropping it turned `/shock ETH -20` into a
        // scenario nobody asked for with nothing on screen to say a character
        // had gone missing.
        const also = alsoTyped(rest)
        if (also) onKey(also, TEXT_ONLY)
        return
      }
      // A chunk that is nothing but the front of a report: wait for the rest.
      if (partial) return
      // Type-ahead: keys pressed before the shell was reading, or faster than it
      // draws, reach it in one read — Enters and ctrl chords included, which
      // Ink does not split out of the text, and a bracketed paste never arrives
      // this way. Split and replayed a piece per render, so `/refresh` opens its
      // menu before its Enter lands. A line break is Enter here: a terminal
      // still in cooked mode turned that Enter into one.
      if (ch.length > 1 && !ch.includes('\x1b') && (/[\r\n]/.test(ch.slice(0, -1)) || CONTROL.test(ch))) {
        setTypeAhead((waiting) => [...waiting, ...ch.split(PIECES).filter(Boolean)])
        return
      }
      onKey(ch, key)
    },
    { isActive: !credentials && !connecting },
  )

  /**
   * A bracketed paste, which Ink delivers whole while this hook is mounted and
   * the terminal brackets it: inserted with its line breaks, and never a submit
   * (Readline's `enable-bracketed-paste`, zsh's `bracketed-paste`). Lines that
   * hold one line take it as they always have — a paste into the deletion
   * prompt ending in a newline still answers it.
   */
  usePaste(
    (text) => {
      const clean = pasted(text)
      if (palette) return editQuery((q) => insert(q, typed(clean).text))
      if (forgetting) {
        const { text: name, submits } = typed(clean)
        const next = insert(editorNow.current, name)
        return submits ? confirmForget(next.text) : changeLine(next)
      }
      const into = search ? takeSearch() : editorNow.current
      const vim = vimNow.current
      if (vim?.mode === 'insert') setVim(vimTyped(vim, clean))
      changeLine(insert(into, clean))
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
      // A price source holds one key and is not a venue, so it has no set to
      // choose from and must never be shown one.
      existing={pendingPrice ? [] : connectExisting}
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
        setConnectExisting([])
        setPendingPrice(null)
        push(outcome.ok ? 'notice' : 'output', outcome.message)
        if (!outcome.ok) return
        // Busy from here, not from `showState`. The venue is actually read by
        // the refresh below — seconds of it, on a book like this one — and that
        // used to run with the spinner off, so the screen sat on "Connected"
        // with nothing moving. By the time `showState` raised it the cache was
        // warm and it flashed for a frame. One span covers the whole wait, and
        // `session.onProgress` names the venue being read while it does.
        setWorking(true)
        try {
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
        } catch (err) {
          // `onDone` is a void-typed prop, so a throw out of this async handler
          // is an unhandled rejection rather than a line on screen — and the
          // store read above throws on exactly the tampering it exists to
          // refuse. The `finally` restored the spinner and let the crash run.
          push('error', failureText(err))
        } finally {
          setWorking(false)
        }
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
      borderColor={inert ? theme.muted : theme.accent}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Text color={inert ? theme.muted : theme.accent}>{'❯ '}</Text>
      <InputLine
        value={search ? searched : input}
        // On the match, where Readline leaves point during a search.
        cursor={search ? Math.max(0, searchMatches ? searched.indexOf(search.query) : searched.length) : cursor}
        dim={inert}
        width={textWidth}
        {...(ghost && !inert ? { suggestion: ghost } : {})}
        placeholder={
          forgetting || search
            ? ''
            : busy
              ? PLACEHOLDER_BUSY
              : cells(PLACEHOLDER_HINTED) + 2 <= textWidth
              ? PLACEHOLDER_HINTED
              : PLACEHOLDER
        }
      />
    </Box>
  )

  /**
   * The row under the line while ctrl+r is up: what is being searched for, and
   * — because a search that stops matching leaves the last match standing —
   * that nothing matches, rather than a line that looks like an answer.
   */
  const searchHint = !search
    ? ''
    : history.length === 0
      ? 'history is empty — nothing to search yet · esc to close'
      : search.query === ''
        ? 'search history: type part of an earlier line · ctrl+g to cancel'
        : searchMatches
          ? `search history: “${search.query}” · ctrl+r older · enter runs · esc edits · ctrl+g cancels`
          : `nothing in history matches “${search.query}” · backspace to widen · ctrl+g cancels`

  /**
   * The `?` panel. A panel, not a modal: it sits in the frame above the input,
   * and the frame has to stay shorter than the viewport, or Ink clears on every
   * keystroke. So it shows the rows that fit and ends on the command that prints
   * the rest. Each row is truncated, never wrapped, for the reason the status
   * line is.
   */
  const keysLines = keysText({ vim: vim !== null, vimFirst: true }).split('\n')
  const keysRoom = Math.max(3, rows - inputRows - 2 - 1 - (expanded ? 1 : 0) - 2 - workRows)
  const keysCut = keysLines.length + 1 > keysRoom
  const keysShown = keysCut ? keysLines.slice(0, keysRoom - 1) : keysLines
  const keysPanel = (
    <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
      {keysShown.map((line, at) =>
        line !== '' && !line.startsWith(' ') ? (
          <Text key={`k${at}`} color={theme.notice} wrap="truncate">
            {line}
          </Text>
        ) : (
          <Text key={`k${at}`} dimColor wrap="truncate">
            {line || ' '}
          </Text>
        ),
      )}
      <Text dimColor wrap="truncate">
        {keysCut
          ? `… ${keysLines.length - keysShown.length} more rows · /keys prints every key · Esc closes`
          : 'Esc or ? closes'}
      </Text>
    </Box>
  )

  const statusBox = (
    <Box paddingLeft={1} flexDirection="column">
      {/* Truncated on purpose: a status line that wraps is a row Ink counts
          as one, and its next erase leaves the remainder standing. */}
      <Text wrap="truncate">
        {/* The mode beside the line, as Claude Code draws it. Gold for NORMAL,
            the lighter notice gold for INSERT, and never red, which means
            something is wrong. Dim goes on the status alone: a parent's dim
            would dull the mode too. */}
        {vim && (
          <Text bold color={vim.mode === 'normal' ? theme.accent : theme.notice}>
            {vim.mode === 'normal' ? '-- NORMAL --  ' : '-- INSERT --  '}
          </Text>
        )}
        <Text dimColor>{status}</Text>
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
            query={palette.query.text}
            cursor={palette.query.cursor}
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
            {/* Not while the keys panel is up: the panel's rows are counted
                against a frame that does not hold this block. */}
            {nothingConnected && entries.length === 0 && !keysOpen && (
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
                  {stopNote ? `  ·  ${stopNote}` : ''}
                </Text>
              </Box>
            )}

            {/* Above the input, where Claude Code, Codex and Gemini CLI draw
                theirs, oldest first as they will run. Three rows and a count, so
                a long queue does not push the line being typed off the screen. */}
            {queue.length > 0 && (
              <Box flexDirection="column" paddingLeft={3} marginBottom={1}>
                <Text dimColor wrap="truncate">
                  {`queued — ${queue.length === 1 ? 'runs' : 'run in order'} when this one finishes · ↑ on an empty line takes the last back`}
                </Text>
                {queue.slice(0, QUEUE_ROWS).map((line, at) => (
                  <Text key={`q${at}`} wrap="truncate">
                    {`↳ ${line.split('\n')[0]}${line.includes('\n') ? ' …' : ''}`}
                  </Text>
                ))}
                {queue.length > QUEUE_ROWS && (
                  <Text dimColor wrap="truncate">{`  … and ${queue.length - QUEUE_ROWS} more`}</Text>
                )}
              </Box>
            )}

            {keysOpen && keysPanel}

            {renderInputBox(false)}

            {/* One row, under the line the name is being typed on, so what
                the question asked for is still on screen once the placeholder
                has gone. Truncated: a hint that wraps is a row Ink counts as
                one, and its next erase leaves the remainder standing. */}
            {forgetting && (
              <Box paddingLeft={1}>
                <Text color={theme.notice} wrap="truncate">
                  {`type ${forgetting.word} to confirm · Esc to keep ${forgetting.label}`}
                </Text>
              </Box>
            )}

            {/* Truncated for the reason the row above is. */}
            {search && (
              <Box paddingLeft={1}>
                <Text color={theme.notice} wrap="truncate">
                  {searchHint}
                </Text>
              </Box>
            )}

            {menu && (
              <SlashMenu
                items={menu.items}
                selected={menuIndex}
                prefix={menu.prefix}
                limit={menuRows}
                offset={menuOffset}
                {...(menu.level !== 'top' ? { heading: menu.heading } : {})}
                {...(menu.level === 'args' && menu.empty ? { empty: menu.empty } : {})}
              />
            )}

            {statusBox}
          </>
        ))}
    </Box>
  )
}
