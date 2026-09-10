import Decimal from 'decimal.js'
import { envApiKey, envApiKeyName, hasAmbientCredentials } from '../agent/agent.js'
// The build's own venues, and the only list of them. The commands that take a
// `connectors` map take it for the roster they print; what a connector declares
// about its own coverage is a fact about the build, and reading it from two
// places is how the sentence and the code stop agreeing.
import { CONNECTORS } from '../connectors/registry.js'
import { chainById } from '../connectors/chains.js'
import { isRetired, retired, type Connector } from '../connectors/types.js'
import {
  availabilityById,
  claimed,
  constrained,
  overclaimed,
  RELEASES,
  type Availability,
} from '../core/availability.js'
import {
  areaLines,
  availabilityFacts,
  disclosure,
  list,
  notReadDetail,
  unrankedVenues,
  type Disclosure,
} from '../core/coverage.js'
import { belongsToVenue, type Position, type VenueKind } from '../core/position.js'
import type { PriceProvider } from '../prices/providers.js'
import { portfolioValue, type PortfolioValue } from '../core/exposure.js'
import {
  scenario,
  shockedHealthFactors,
  usableShock,
  whatBreaksFirst,
  SHOCK_CEILING,
  SHOCK_FLOOR,
  type LiquidationRisk,
  type Shock,
  type ShockedDebt,
  type ShockedHealthFactor,
} from '../core/risk.js'
import { freshness, healthFactor, holdings, pct, price, quantity, usd } from '../core/format.js'
import { renderTable, type Align } from '../ui/table.js'
import * as secrets from '../secrets/store.js'
import { APP_DESCRIPTION, APP_NAME, APP_VERSION, IS_PRE_RELEASE, REPO_URL } from '../version.js'
import {
  connectCommand,
  forgetCommand,
  namesCommand,
  pickVenue,
  signInCommand,
  typed,
} from './registry.js'
import type { Altered, Alteration, Session } from './session.js'

export interface CommandResult {
  output: string
  /**
   * The tail of `output` that the transcript may not truncate away — what
   * `incompleteNote` returned for this view, handed over rather than left to be
   * recomputed. The note is not the same on every call: the REMOVED
   * explanation is a one-time thing, so a second call for the same view returns
   * the short form and would pin a block the output does not end with.
   */
  note?: string
  /** Something the user must know is missing. Drives a non-zero exit. */
  incomplete?: boolean
  /** The command was not usable as written. Also a non-zero exit, so a typo in
   *  a script is not mistaken for success. */
  usageError?: boolean
}

/** The venue id a failure line opens with. */
export const failedVenue = (failure: string): string => failure.split(':')[0] ?? '<venue>'

/**
 * Whether anything is missing from the view — the one question every command's
 * exit code answers. Read from the same two fields the note below is built
 * from, so a command that renders its failures its own way cannot disagree with
 * one that prints the note: `tula refresh && tula exposure` exited 0 and then 1
 * for the same state, and a script cannot tell which answer it was handed.
 *
 * A venue this build dropped counts here, so a stored key for one exits
 * non-zero. Unsettled on purpose: the book genuinely is short of a venue
 * somebody connected, and the output says `REMOVED` rather than `INCOMPLETE`, so
 * nothing claims a venue went down — against which, nothing was asked of it, and
 * an exit code is read by scripts that cannot see the difference. It stands
 * until somebody decides, and `src/consistency.test.ts` pins every view
 * agreeing about it, so a change is one decision rather than a drift.
 */
export function isIncomplete(session: Session): boolean {
  const { failures, priceError } = session.current
  return failures.length > 0 || priceError !== null
}

/**
 * What the venues that answered declare they never ask their venue for.
 *
 * A venue is out of it only where nothing at all came back from it: a venue
 * that answered in part is exactly what this line is about, and a venue
 * watching several addresses now fails one of them at a time — dropped on the
 * first failure, the wallet that did answer would go undisclosed with it.
 */
function uncovered(session: Session): Disclosure {
  const { connected, failures, positions: all } = session.current
  const silent = failures
    .map(failedVenue)
    .filter((venue) => !all.some((p) => belongsToVenue(p.venue, venue)))
  return disclosure(CONNECTORS, connected, silent)
}

/**
 * Sessions that have already been given the whole REMOVED explanation.
 *
 * The fact has to persist — a credential for a venue tula no longer reads is a
 * secret sitting on disk that its owner has forgotten — but the paragraph
 * saying why the venue went, that `/forget` takes tula's copy only, and that
 * revoking the key at the venue is a separate act is read once and is nagging
 * from the second view on.
 *
 * Keyed by session rather than held in a module flag so two sessions in one
 * process — and each test here — start from nothing. There is deliberately no
 * store behind it: the one-shot CLI is a fresh process per command, so `tula
 * exposure` twice prints the whole thing twice, which is right. Somebody who
 * never opens the shell has no session to carry the fact through and is exactly
 * the person still holding the key.
 */
const explained = new WeakSet<Session>()

/** tula's own words for tula's own act. The venue's string is not among them. */
const ALTERED_WHY: Readonly<Record<Alteration, string>> = {
  hidden: 'hidden characters removed',
  long: 'too long for the column, cut to fit',
  empty: 'nothing printable in them',
}

/** As `unpricedNote`, and for the same reason: a hostile node can send hundreds. */
const ALTERED_SHOWN = 6

/**
 * The fifth thing a view says about itself, and the only one where nothing is
 * missing and nothing failed — so it raises no exit code, prints no
 * `INCOMPLETE`, and says in its first line that there is nothing to go and get.
 * A venue spelled an asset in text this build could not draw as sent, so the
 * ASSET column holds tula's printable reading of it and the reader was told
 * nothing: the `untrusted` sidecar says it to the model, and every view here
 * works without one.
 *
 * What it shows is the venue and the *bounded* name — the one already in the
 * table, so the two can be matched by eye. What the venue actually sent is
 * never printed. That string is the thing that repaints a line, and rendering
 * it to prove it was dangerous is the defect the bound exists to prevent.
 */
function alteredLines(altered: readonly Altered[]): string[] {
  if (altered.length === 0) return []
  const groups = new Map<string, Altered[]>()
  for (const a of altered) {
    const key = `${a.venue} ${a.why}`
    groups.set(key, [...(groups.get(key) ?? []), a])
  }

  const lines = [
    `ALTERED — ${altered.length} asset name(s) are not as the venue sent them. Nothing is missing.`,
  ]
  for (const rows of groups.values()) {
    const [first] = rows as [Altered, ...Altered[]]
    // Nothing survived the filter, so there is no name to list — the count is
    // the whole of what can be said, and an empty item in a comma list is a
    // line that looks truncated.
    if (first.why === 'empty') {
      lines.push(`  ${first.venue}  ${rows.length} name(s) with ${ALTERED_WHY.empty}`)
      continue
    }
    const rest = rows.length - ALTERED_SHOWN
    const shown = rows.slice(0, ALTERED_SHOWN).map((a) => a.asset).join(', ')
    lines.push(
      `  ${first.venue}  ${ALTERED_WHY[first.why]}: ${shown}${rest > 0 ? `, and ${rest} more` : ''}`,
    )
  }

  // Rule 7. Whoever answers as the node writes every reserve symbol tula reads
  // on that chain, and the variable is the whole of the way out — so it is
  // named wherever a chain is involved. A venue that is not a chain has no node
  // to swap: the name is its own listing, and being told which venue sent it is
  // what there is to do about it.
  const nodes = [
    ...new Set(altered.flatMap((a) => (a.chain ? (chainById(a.chain).rpcEnv[0] ?? []) : []))),
  ]
  lines.push(
    nodes.length === 0
      ? '  A name is the venue’s own text, never tula’s. Check one at the venue before acting on it.'
      : `  A name is the venue’s own text, never tula’s. ${nodes.join(', ')} ${
          nodes.length === 1 ? 'picks' : 'pick'
        } the node that sent it.`,
  )
  return lines
}

/**
 * Everything a view says about itself: which venues failed, which this build
 * dropped, and whether prices answered. Each names a state that ends — a venue
 * comes back, a key is forgotten, a price source answers again — which is what
 * earns a line on every view.
 *
 * What a connector never asks its venue for is not here, and that is the whole
 * distinction: coverage does not resolve. A read-only tool has unbounded
 * uncovered surface by construction, so a count of it printed beside every
 * figure is a number that never reaches zero, and the reader learns to skip the
 * block it sits in — taking `INCOMPLETE` with it, which is about their money
 * today. `src/core/coverage.ts` states that rule about venues with no connector
 * at all; this is the same rule one level up. `/venues` and a venue's own
 * `status` name every area, and `unreadVenue()` below says it where it is
 * actually about this account: a venue that answered and holds nothing.
 *
 * Called once per view: it advances the session past the REMOVED explanation,
 * so what it returns is handed on as `CommandResult.note` rather than asked for
 * a second time.
 */
export function incompleteNote(session: Session): string {
  const { failures, priceError, stale, altered } = session.current
  const lines: string[] = []
  // Removed, failed and never-asked are three different things, and a reader
  // must not have to work out which one they are looking at. A venue this build
  // dropped was never attempted, so nothing about it failed — and counting it
  // among the failures told somebody with a stored Circle key that a venue had
  // gone down.
  const gone = failures.filter((f) => isRetired(failedVenue(f)))
  const failed = failures.filter((f) => !isRetired(failedVenue(f)))

  if (failed.length > 0) {
    lines.push(`\nINCOMPLETE — ${failed.length} venue(s) failed. This is not your full exposure.`)
    // Per failure, not once for the list. A failure already naming a remedy
    // needs no second one, and what makes a line a remedy is that it names a
    // command tula has — not that it happens to contain a slash, which a venue
    // quoting a URL does.
    for (const f of failed) {
      lines.push(`  ${f}`)
      const venue = failedVenue(f)
      if (!namesCommand(f, session.venueIds)) {
        lines.push(
          `    Run ${typed(`${venue} status`)} to see why, or ${typed('refresh')} to try again.`,
        )
      }
      // Its rows are still in every total on screen, and a reader looking at a
      // figure has not read the column that dates it. Said here, beside the
      // failure that explains why they were kept.
      if (stale.includes(venue)) {
        lines.push('    Its rows are the last read tula has, not this one — AS OF says when.')
      }
    }
  }

  if (gone.length > 0) {
    // Once per session, then the fact alone. The whole explanation is already
    // in each line below — `retired()` writes it — and a venue nobody can ask
    // anything of does not change between two views of the same book.
    if (explained.has(session)) {
      for (const [at, f] of gone.entries()) {
        const venue = failedVenue(f)
        lines.push(`${at === 0 ? '\n' : ''}REMOVED — ${venue}, still stored. ${forgetCommand(venue)}`)
      }
    } else {
      explained.add(session)
      lines.push(
        `\nREMOVED — ${gone.length} venue(s) tula no longer reads. Nothing was asked of them, and nothing failed.`,
      )
      for (const f of gone) lines.push(`  ${f}`)
    }
  }

  // No label of its own: every price source says "Prices are unavailable" in
  // the message itself, and prefixing one printed the sentence twice.
  if (priceError) lines.push(`\n${priceError}`)

  // Last of the five, because it is the only one about text rather than about
  // holdings: nothing here is absent from the book, missing from a total or
  // waiting on a command. `''` opens the blank line every other block opens
  // with, and reads as one leading newline where this block is the only one.
  const changed = alteredLines(altered)
  if (changed.length > 0) lines.push('', ...changed)
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
async function emptyBook(session: Session): Promise<string> {
  const stored = await secrets.listVenues()
  const live = stored.filter((id) => !isRetired(id))
  if (stored.length === 0) {
    return (
      'No venue is connected yet, so there is nothing to measure.\n' +
      // On its own line because `pickVenue()` ends in `<venue>` on the CLI, and
      // a sentence continuing from there reads as another argument to it.
      `  ${pickVenue()}\n` +
      '  Wallet, Hyperliquid and Aave need only a public address — no key,\n' +
      '  nothing to leak.'
    )
  }
  // Everything stored is a venue this build dropped, which is neither an empty
  // account nor a venue that failed. The block below names each and says why.
  if (live.length === 0) {
    return (
      'Nothing is connected that this build still reads, so there is nothing to measure.\n' +
      `  ${pickVenue()}`
    )
  }

  // A venue that failed did not return nothing; it was never read. Counting it
  // among the empty ones told the reader their account was empty two lines
  // above an INCOMPLETE block saying it had not been reached — and "the account
  // is empty, or it is not the one you trade with" is a bad thing to be told
  // about a book nobody managed to open.
  const failed = new Set(session.current.failures.map(failedVenue))
  const read = live.filter((id) => !failed.has(id))
  if (read.length === 0) {
    return (
      `Nothing could be read: ${live.length === 1 ? 'the venue' : 'every venue'} you have connected failed.`
    )
  }

  // The third possibility, and the one this whole disclosure was built for: a
  // venue that answered about the part of itself tula reads, holding everything
  // in the part it does not. Somebody on Aave V4 sees exactly this screen, and
  // offered two explanations that are both wrong they go and check an address
  // that was right all along. `unreadVenue()` says it for one venue's own view;
  // this is the same sentence where the whole book came back empty, which is
  // where it is most likely to be the answer.
  const named = read.join(', ')
  const unread = read.some((id) => disclosure(CONNECTORS, [id]).areas.length > 0)
  const them = read.length === 1 ? named : 'them'
  return (
    `${named} ${read.length === 1 ? 'is' : 'are'} connected and returned nothing.\n` +
    `  Either the account is empty, it is not the one you trade with${
      unread ? `,\n  or what it holds is in a part of ${them} nothing here reads` : ''
    }.\n` +
    `  ${typed(`${read[0]} status`)} shows what tula is reading${unread ? ' and what it is not' : ''};\n` +
    `  ${typed('refresh')} refetches now.`
  )
}

/**
 * The states one venue can be in with no rows to draw, for the commands scoped
 * to one: never read, or read and empty. `emptyBook` was fixed for exactly this
 * and the per-venue commands never got it — so a rate-limited RPC was reported
 * as an account that may be empty, under an offer to replace the address, which
 * is the wrong act for a node that did not answer.
 *
 * A third possibility joins the empty one wherever the venue declares something
 * it does not read: the account may hold what it always held, in a part of the
 * venue nothing here asks about. That is the whole of the Aave V4 case — an
 * empty book, nothing failed, and nothing on screen saying why.
 *
 * Null means the venue answered and holds something; there is a table to draw.
 */
function unreadVenue(session: Session, venueId: string, kind: VenueKind, held: number): string | null {
  if (held > 0) return null
  if (session.current.failures.some((f) => failedVenue(f) === venueId)) {
    return (
      `${venueId} could not be read, so there is nothing to show for it — this is not an empty account.\n` +
      '  What failed is named below, with the way out.'
    )
  }
  const unread = disclosure(CONNECTORS, [venueId]).areas.length > 0
  return (
    `${venueId} returned ${kind === 'wallet' ? 'no tokens' : 'nothing'}.\n` +
    `  Either the account is empty, it is not the one you meant to connect${
      unread ? `,\n  or what it holds is in a part of ${venueId} nothing here reads` : ''
    }.\n` +
    `  ${typed(`${venueId} status`)} shows what tula is reading${unread ? ' and what it is not' : ''};\n` +
    `  ${connectCommand(venueId)} adds another account, or replaces this one.`
  )
}

/**
 * What a ranking of liquidations cannot see.
 *
 * The one place a coverage gap still reaches a view unasked, and it is here
 * because `breaks` and `shock` claim more than the other commands do: they say
 * what can be called in, in order. A venue in this book with an unread area
 * that could hold a liquidation of its own makes that order wrong rather than
 * short — and an order that is wrong about what breaks first is the answer this
 * product exists to get right. Under `positions` the same gap is a total
 * smaller than the account, which is `/venues`' to say and not every view's.
 *
 * Takes the rows in view rather than the whole book, so `<venue> breaks` says
 * it about that venue and no other — named there, a gap at a venue the reader
 * did not ask about is the nagging this was narrowed to avoid.
 *
 * `src/core/coverage.ts` narrows it: liquidation-hiding areas only, at venues
 * that actually returned rows. So it shortens as those gaps close, disappears
 * with the last of them, and never fires over a book the venue is absent from.
 */
function unrankedNote(session: Session, positions: readonly Position[]): string {
  const venues = unrankedVenues(uncovered(session), positions)
  if (venues.length === 0) return ''
  return (
    `\n\nRanked over what tula reads: ${list(venues)} ${venues.length === 1 ? 'has' : 'each have'} ` +
    `an unread area that could hold a liquidation of its own.\n  ${typed('venues')} names them.`
  )
}

/** What a venue publishes about a position it can call in. */
export function trigger(position: Position): string {
  const params = position.liquidation
  if (params?.healthFactor !== undefined) return `health factor ${healthFactor(params.healthFactor)}`
  if (params?.price !== undefined) return `liq price ${price(params.price)}`
  return 'unknown'
}

/**
 * How much of each row can actually be moved. Read once per view: the graph
 * behind it is inverted in `src/core/availability.ts` and nowhere else, so two
 * tables cannot answer differently about one holding.
 */
function movable(session: Session): Map<string, Availability> {
  return availabilityById(
    session.current.positions,
    availabilityFacts(CONNECTORS, session.current.connected),
  )
}

/**
 * Which of a venue's accounts a row came from — present only where that venue
 * holds more than one, so a book with one wallet gains no column. The answer to
 * "what breaks first" is unusable without it once there are two: it names the
 * venue to act at and not the address to act on.
 */
const account = (p: Position): string => p.account?.label ?? '—'

/**
 * The FREE and UNAVAILABLE cells for one row. A debt or a short has no entry at
 * all — it is not a holding, and there is nothing about it to free — so both
 * cells are em dashes rather than the negative quantity read as cash.
 */
function split(a: Availability | undefined): [string, string] {
  if (!a) return ['—', '—']
  if (a.claims.length === 0) return [quantity(a.free), '—']
  return [quantity(a.free), `${quantity(claimed(a))} ${a.claims.map((c) => c.reason).join(', ')}`]
}

/**
 * What releases each hold on this book, one line per reason present. The
 * quantity says a holding cannot move; this is the half that says what to do
 * about it, which is the whole reason there is no single "encumbered" bucket.
 */
function releaseNotes(rows: Availability[]): string[] {
  const reasons = [...new Set(rows.flatMap((a) => a.claims.map((c) => c.reason)))]
  const unknown = [...new Set(rows.map((a) => a.unprovable).filter((w) => w !== null))]
  if (reasons.length === 0 && unknown.length === 0) return []

  const UNPROVEN = 'free unknown'
  const width = Math.max(...[...reasons, ...(unknown.length > 0 ? [UNPROVEN] : [])].map((l) => l.length))
  const lines = ['Not free to move, and what releases it:']
  for (const reason of reasons) lines.push(`  ${reason.padEnd(width)}  ${RELEASES[reason]}`)
  // Not a hold and not a figure: the venue reports nothing that proves what is
  // free, so the column is an em dash rather than the whole balance.
  for (const why of unknown) lines.push(`  ${UNPROVEN.padEnd(width)}  ${why}`)
  if (rows.some(overclaimed)) {
    lines.push(
      '',
      '  One holding is claimed for more than it holds — a health factor under 1 — so it is',
      `  already liquidatable rather than merely pledged. ${typed('breaks')} ranks it.`,
    )
  }
  return lines
}

/**
 * A table whose columns are chosen from the rows rather than fixed. Two of them
 * are conditional — the account a row came from, and the free/held split — and
 * spelling each condition once per header, cell and alignment is three places
 * that have to stay in step for the columns not to slide sideways.
 */
interface Column<T> {
  head: string
  align: Align
  cell: (row: T) => string
}

const draw = <T>(columns: Column<T>[], rows: readonly T[]): string =>
  renderTable(
    columns.map((c) => c.head),
    rows.map((row) => columns.map((c) => c.cell(row))),
    columns.map((c) => c.align),
  )

/** Present only where the venue in question holds more than one account. */
const accountColumn = <T>(rows: readonly T[], of: (row: T) => Position): Column<T>[] =>
  rows.some((row) => of(row).account)
    ? [{ head: 'ACCOUNT', align: 'left', cell: (row) => account(of(row)) }]
    : []

/**
 * The columns a positions table has, which is deliberately not a fixed list.
 * The account appears only where a venue holds more than one, and the free/held
 * pair only where something is actually held: a column that says the same thing
 * on every row costs attention and returns nothing.
 */
function positionColumns(
  rows: readonly Position[],
  free: Map<string, Availability>,
  now: Date,
): Column<Position>[] {
  const held = rows.some((p) => {
    const a = free.get(p.id)
    return a !== undefined && constrained(a)
  })
  const availability: Column<Position>[] = held
    ? [
        { head: 'FREE', align: 'right', cell: (p) => split(free.get(p.id))[0] },
        { head: 'UNAVAILABLE', align: 'left', cell: (p) => split(free.get(p.id))[1] },
      ]
    : []
  return [
    ...accountColumn(rows, (p) => p),
    { head: 'KIND', align: 'left', cell: (p) => p.kind },
    { head: 'ASSET', align: 'left', cell: (p) => p.asset },
    { head: 'QUANTITY', align: 'right', cell: (p) => quantity(p.quantity) },
    ...availability,
    { head: 'AS OF', align: 'left', cell: (p) => freshness(p.asOf, now) },
  ]
}

/**
 * The venue says where to go and the account says what to act on: on a book
 * watching two wallets, a liquidation distance carrying only the venue names
 * neither of them.
 */
function riskColumns(risks: readonly LiquidationRisk[], now: Date): Column<LiquidationRisk>[] {
  return [
    ...accountColumn(risks, (r) => r.position),
    { head: 'ASSET', align: 'left', cell: (r) => r.position.asset },
    { head: 'KIND', align: 'left', cell: (r) => r.position.kind },
    {
      head: 'MOVE TO LIQ',
      align: 'right',
      cell: (r) => (r.liquidatable ? 'liquidatable now' : r.move === null ? 'unknown' : pct(r.move)),
    },
    { head: 'TRIGGER', align: 'left', cell: (r) => trigger(r.position) },
    { head: 'AS OF', align: 'left', cell: (r) => freshness(r.position.asOf, now) },
  ]
}

/** The half that says what to do about what is held, or nothing to say. */
function legendFor(rows: readonly Position[], free: Map<string, Availability>): string {
  const lines = releaseNotes(rows.flatMap((p) => free.get(p.id) ?? []))
  return lines.length === 0 ? '' : `\n\n${lines.join('\n')}`
}

export async function positions(session: Session): Promise<CommandResult> {
  const { positions: all } = await session.ensureLoaded()
  const note = incompleteNote(session)
  if (all.length === 0) {
    return { output: (await emptyBook(session)) + note, note, incomplete: isIncomplete(session) }
  }

  const now = new Date()
  const sorted = [...all].sort(
    (a, b) =>
      a.venue.localeCompare(b.venue) || a.asset.localeCompare(b.asset) || a.kind.localeCompare(b.kind),
  )
  const free = movable(session)
  const columns: Column<Position>[] = [
    { head: 'VENUE', align: 'left', cell: (p) => p.venue },
    ...positionColumns(sorted, free, now),
  ]
  return {
    output: draw(columns, sorted) + legendFor(sorted, free) + note,
    note,
    incomplete: isIncomplete(session),
  }
}

export async function exposure(session: Session): Promise<CommandResult> {
  await session.ensureLoaded()
  const exposures = session.exposures()
  const note = incompleteNote(session)
  if (exposures.length === 0) {
    return { output: (await emptyBook(session)) + note, note, incomplete: isIncomplete(session) }
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
  // Notional, not worth: an exposure is `delta × price`, so a perp contributes
  // the whole position rather than the margin behind it, and a leveraged book
  // called this "Net value" overstated net worth by its leverage.
  const lines = [table, '', `Net notional  ${usd(value.total)}`, ...unpricedNote(value)]
  return { output: lines.join('\n') + note, note, incomplete: isIncomplete(session) }
}

export async function breaks(session: Session): Promise<CommandResult> {
  const { positions: all, prices } = await session.ensureLoaded()
  const risks = whatBreaksFirst(all, prices)
  const note = incompleteNote(session)
  // An empty book and a book with nothing leveraged in it are opposite answers.
  // "Nothing here can be liquidated" over no positions at all is the reassuring
  // version of a wrong number: it reads as a book that was read and found safe.
  if (all.length === 0) {
    return { output: (await emptyBook(session)) + note, note, incomplete: isIncomplete(session) }
  }
  // "Nothing can be liquidated" is the strongest claim this command makes, so
  // it is the answer that most needs what the ranking could not see.
  if (risks.length === 0) {
    return {
      output:
        'Nothing here can be liquidated — no leverage, no borrowing, nothing to call.\n' +
        '  Spot balances cannot be taken from you, so there is nothing to rank.' +
        unrankedNote(session, all) +
        note,
      note,
      incomplete: isIncomplete(session),
    }
  }

  const now = new Date()
  const columns: Column<LiquidationRisk>[] = [
    { head: 'VENUE', align: 'left', cell: (r) => r.position.venue },
    ...riskColumns(risks, now),
  ]
  return {
    output: draw(columns, risks) + unrankedNote(session, all) + note,
    note,
    incomplete: isIncomplete(session),
  }
}

/**
 * A shocked health factor moves the collateral and holds the debt at today's
 * value. Said only where this book breaks that assumption — a market that has
 * borrowed something the scenario moves — because under every figure it is a
 * line nobody reads, and here it is the difference between a number to act on
 * and one that is wrong on the side that matters.
 */
function debtHeldStill(markets: ShockedHealthFactor[]): string[] {
  const REAL: Readonly<Record<ShockedDebt['real'], string>> = {
    higher: 'so the real one is higher.',
    lower: 'so the real one is lower.',
    unknown: 'so the real one moves with that debt as well.',
  }
  return markets.flatMap(({ venue, debt }) =>
    debt === null
      ? []
      : [
          `  ${venue} borrows ${debt.assets.join(', ')}, which this shock moves. The factor above`,
          `  reprices its collateral only, ${REAL[debt.real]}`,
        ],
  )
}

const SHOCK_USAGE = 'Usage: shock <ASSET> <PERCENT>   e.g. shock ETH -20'

export async function shock(session: Session, args: string[]): Promise<CommandResult> {
  const shocks: Shock[] = []
  // Stepping by two dropped an odd trailing word and the heading listed only
  // what parsed, so `shock ETH -20 BTC` priced a scenario without BTC in it and
  // nothing on screen said BTC had been left out.
  if (args.length % 2 !== 0) {
    return {
      output:
        `"${args[args.length - 1]}" has no percentage after it, so nothing here would move it.\n` +
        '  Each asset takes one: shock ETH -20 BTC -10\n' +
        `  ${SHOCK_USAGE}`,
      usageError: true,
    }
  }
  for (let i = 0; i + 1 < args.length; i += 2) {
    const asset = args[i]?.toUpperCase()
    const raw = args[i + 1]?.replace('%', '')
    if (!asset || raw === undefined || raw === '' || Number.isNaN(Number(raw))) {
      return { output: SHOCK_USAGE, usageError: true }
    }
    const move = new Decimal(raw).div(100)
    // Refused rather than answered: `Number('1e400')` is Infinity and not NaN,
    // so the check above let a figure through that is no longer a question, and
    // -150% repriced a book to less than nothing. The engine bounds it too, but
    // an out-of-range input is a typo to name, not a scenario to reprice.
    if (!usableShock(move)) {
      return {
        output:
          `${raw}% is not a scenario: a move runs from ${pct(SHOCK_FLOOR, 0)}, where the asset is\n` +
          `  worth nothing, up to ${pct(SHOCK_CEILING, 0)}.\n  ${SHOCK_USAGE}`,
        usageError: true,
      }
    }
    shocks.push({ asset, pct: move })
  }
  if (shocks.length === 0) {
    return { output: SHOCK_USAGE, usageError: true }
  }

  const { positions: all, prices } = await session.ensureLoaded()
  const note = incompleteNote(session)
  // Repricing nothing produces $0.00 before, $0.00 after and "nothing
  // liquidates" — three true figures that together answer a question about a
  // book this session never had.
  if (all.length === 0) {
    return { output: (await emptyBook(session)) + note, note, incomplete: isIncomplete(session) }
  }
  const result = scenario(all, prices, shocks)

  const heading = shocks.map((s) => `${s.asset} ${pct(s.pct, 0)}`).join(', ')
  const lines = [
    `Scenario: ${heading}`,
    '',
    `  Before   ${usd(result.before.total)}`,
    `  After    ${usd(result.after.total)}`,
    `  Change   ${usd(result.change)}`,
  ]

  lines.push(...unpricedNote(result.before).map((l) => `  ${l}`))

  // One row per market, weighted by each leg's share of the collateral base —
  // the same figure the agent's answer is built from, because a screen and a
  // model disagreeing about one book is a wrong number wherever the reader
  // happens to look. Reading the shocked leg's own move as the whole base's
  // reported 1.42 -> 0.99 and a liquidation for a market that ends at 1.25.
  const markets = shockedHealthFactors(all, prices, shocks)
  const shockedHealth = markets.map(
    (r) => `  ${r.venue}  health factor ${healthFactor(r.before)} -> ${healthFactor(r.after)}`,
  )
  if (shockedHealth.length > 0) {
    lines.push('', 'Health factors:', ...shockedHealth, ...debtHeldStill(markets))
  }

  lines.push('')
  if (result.liquidated.length === 0) {
    lines.push('Nothing liquidates at this level.')
  } else {
    lines.push('LIQUIDATED:')
    for (const p of result.liquidated) lines.push(`  ${p.venue}  ${p.kind} ${p.asset}`)
  }

  return {
    output: lines.join('\n') + unrankedNote(session, all) + note,
    note,
    incomplete: isIncomplete(session),
  }
}

export async function venues(
  session: Session,
  connectors: Map<string, Connector>,
): Promise<CommandResult> {
  const { positions: all, failures } = await session.ensureLoaded()
  const now = new Date()
  const stored = await secrets.listVenues()

  const rows = stored.map((venueId) => {
    // Removed is not failed — nothing was attempted — and the sentence that
    // says why is 200 characters, which in a cell stretches the rule past the
    // width of any terminal it is read in. It goes under the table instead.
    if (isRetired(venueId)) return [venueId, '—', '—', 'REMOVED — see below']

    const mine = all.filter((p) => belongsToVenue(p.venue, venueId))
    const stalest = mine.reduce((min, p) => (p.asOf < min ? p.asOf : min), now)

    const failure = failures.find((f) => f.startsWith(`${venueId}:`))
    // A venue that failed and had rows to keep still contributes them to every
    // total, so this row counts them and dates them. `—` in both columns said
    // the venue contributed nothing to a book it is contributing to.
    if (failure) {
      const held = mine.length > 0
      return [
        venueId,
        held ? String(mine.length) : '—',
        held ? freshness(stalest, now) : '—',
        `FAILED: ${failure.split(': ').slice(1).join(': ')}`,
      ]
    }

    if (mine.length === 0) return [venueId, '0', '—', 'connected, holding nothing']

    return [venueId, String(mine.length), freshness(stalest, now), 'ok']
  })

  // A failure whose venue is no longer stored still has to be said out loud.
  for (const failure of failures) {
    const [venue = '?', ...rest] = failure.split(': ')
    if (!stored.includes(venue)) rows.push([venue, '—', '—', `FAILED: ${rest.join(': ')}`])
  }

  const detail = notReadDetail(uncovered(session))
  const lines = [
    rows.length > 0
      ? renderTable(['VENUE', 'HOLDINGS', 'AS OF', 'STATUS'], rows, ['left', 'right', 'left', 'left'])
      : `No venues connected yet. ${pickVenue()}`,
    ...stored.flatMap((venueId) => {
      const gone = retired(venueId, forgetCommand(venueId))
      return gone ? ['', `  ${gone}`] : []
    }),
    // Where the one line every other view carries sends the reader. It is held
    // back to here on purpose: twenty areas printed under every table is the
    // wallpaper that line is written to avoid.
    ...(detail.length > 0 ? ['', ...detail] : []),
    '',
    // This table is the venue overview, so a venue whose text tula had to
    // change belongs on it — and it is the one view that names every venue at
    // once, which is where a book altered at two of them reads as two venues.
    ...alteredLines(session.current.altered),
    '',
    `Connectors in this build: ${[...connectors.keys()].join(', ')}`,
    // The venues are what this table is about, but the exit code answers one
    // question for every command — is anything missing — and a price source
    // that did not answer is missing from the same view.
    ...(session.current.priceError ? ['', session.current.priceError] : []),
  ]
  return { output: lines.join('\n'), incomplete: isIncomplete(session) }
}

export async function positionsAt(
  session: Session,
  venueId: string,
  kind: VenueKind,
): Promise<CommandResult> {
  const { positions: all } = await session.ensureLoaded()
  const note = incompleteNote(session)
  const mine = all.filter((p) => belongsToVenue(p.venue, venueId))
  const unread = unreadVenue(session, venueId, kind, mine.length)
  if (unread !== null) return { output: unread + note, note, incomplete: isIncomplete(session) }
  const now = new Date()
  const sorted = mine.sort(
    (a, b) => a.asset.localeCompare(b.asset) || a.kind.localeCompare(b.kind),
  )
  const free = movable(session)
  return {
    output: draw(positionColumns(sorted, free, now), sorted) + legendFor(sorted, free) + note,
    note,
    incomplete: isIncomplete(session),
  }
}

export async function breaksAt(
  session: Session,
  venueId: string,
  kind: VenueKind,
): Promise<CommandResult> {
  const { positions: all, prices } = await session.ensureLoaded()
  // A venue that failed contributes what it last returned, or nothing at all,
  // and either one can compose "nothing can be liquidated". Said about a
  // lending venue nobody could reach, it is the reassuring shape of a wrong
  // answer — so the failure travels with it here as it does everywhere else,
  // exit code included.
  const note = incompleteNote(session)
  const mine = all.filter((p) => belongsToVenue(p.venue, venueId))
  const unread = unreadVenue(session, venueId, kind, mine.length)
  if (unread !== null) return { output: unread + note, note, incomplete: isIncomplete(session) }

  const risks = whatBreaksFirst(mine, prices)
  // The venue answered, and what it holds cannot be called in. That is the one
  // state this sentence is true of; the two above it are a venue nobody read
  // and an account with nothing in it, and both used to read as this one.
  if (risks.length === 0) {
    return {
      output:
        `Nothing at ${venueId} can be liquidated — no leverage, no borrowing, nothing to call.\n` +
        '  Spot balances cannot be taken from you, so there is nothing to rank.' +
        unrankedNote(session, mine) +
        note,
      note,
      incomplete: isIncomplete(session),
    }
  }

  const now = new Date()
  return {
    incomplete: isIncomplete(session),
    output: draw(riskColumns(risks, now), risks) + unrankedNote(session, mine) + note,
    note,
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
    lines.push('  Not connected.', `  Connect with:  ${connectCommand(connector.venue.id)}`)
  } else if (failure) {
    lines.push(`  FAILED — ${failure.split(': ').slice(1).join(': ')}`)
    lines.push('  Numbers elsewhere in tula do not include this venue.')
  } else {
    // reduce() over no rows answers with its seed, so an empty venue used to
    // report the current time as the age of data it does not have.
    const stalest = mine.reduce<Date | null>((min, p) => (min && min < p.asOf ? min : p.asOf), null)
    const held = holdings(connector.venue.kind, mine)
    lines.push(stalest ? `  ${held}, oldest ${freshness(stalest, now)}` : `  ${held}`)
    // Only a venue that asked for a key can have had one checked, and only
    // what the venue will report can be said to have been checked. Saying more
    // here than the connect screen said is the contradiction, not the brevity.
    const unprovable = connector.unprovable ?? []
    lines.push(
      !connector.fields.some((f) => f.secret)
        ? '  A public address only — tula holds no key for this venue.'
        : unprovable.length > 0
          ? `  Its read access was checked. ${connector.venue.name} exposes no way to confirm\n` +
            `  it cannot ${unprovable.join(' or ')}, so tula could not.`
          : '  This key was checked as read-only when you connected.',
    )
    // The screen somebody opens to check what tula reads here is the screen
    // that has to say what it does not. A venue that answered is otherwise
    // taken as complete, which is the whole failure this disclosure exists for.
    const { areas } = disclosure(CONNECTORS, [connector.venue.id])
    if (areas.length > 0) {
      lines.push('', '  Never asked for — read by nothing here, and nothing failed:')
      for (const line of areaLines(areas)) lines.push(`    ${line}`)
    }
  }

  // The screen somebody opens to check what tula reads at this venue is where
  // its text being unprintable belongs, whether the venue answered this time or
  // kept the rows of the read before. Indented to the block, not flush left:
  // every other line here is a fact about this one venue and reads as one.
  const changed = alteredLines(
    session.current.altered.filter((a) => a.venue === connector.venue.id),
  )
  if (changed.length > 0) lines.push('', ...changed.map((line) => `  ${line}`))

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
        ? `${credentialSummary(source)} — ${signInCommand()}`
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
      'placing trades will come later. The build fails if either endpoint appears.',
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
        ? `  Switch to it with:  ${typed(`${provider.id} use`)}`
        : `  It needs an API key first:  ${typed(`${provider.id} connect`)}`,
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
