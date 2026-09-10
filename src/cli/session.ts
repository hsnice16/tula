import Decimal from 'decimal.js'
import { PartialRead, retired, type Connector } from '../connectors/types.js'
import { remote, TulaError } from '../core/errors.js'
import { netExposure, oldest, type PriceMap, type QuoteTimes } from '../core/exposure.js'
import { belongsToVenue, type AssetId, type ChainId, type Position } from '../core/position.js'
import type { PriceOracle } from '../core/prices.js'
import { visible } from '../core/untrusted.js'
import { cells } from '../ui/wrap.js'
import * as secrets from '../secrets/store.js'
import { connectCommand, typed } from '../core/surface.js'
import { forgetCommand } from './registry.js'

/** What `symbol()` did to a name the venue sent, in the words the reader gets. */
export type Alteration = 'hidden' | 'empty' | 'long'

/** One asset name a venue spelled in text this build could not print as sent. */
export interface Altered {
  venue: string
  /**
   * The bounded name — the one the ASSET column already draws. What the venue
   * actually sent never travels: it is precisely the string that repaints a
   * line, and printing it to show the reader it was dangerous would be the
   * defect `symbol()` exists to prevent.
   */
  asset: string
  why: Alteration
  /** Present where the row came off a chain, because that names the way out. */
  chain?: ChainId
}

export interface LoadResult {
  positions: Position[]
  /** Venue-level failures. Never empty and ignored: the view is incomplete. */
  failures: string[]
  /**
   * Every venue that was asked, whether or not it answered with a row. A view
   * built from the positions alone cannot tell a connected venue holding
   * nothing from a venue nobody connected, and reported both as the second.
   */
  connected: string[]
  /**
   * Venues whose rows in `positions` are the read before this one: they failed
   * and returned nothing, so the book keeps what they last gave rather than
   * dropping them out of it. Empty on a load where nothing failed.
   */
  stale: string[]
  /**
   * Names a venue sent that are on screen as something other than what arrived.
   * Nothing failed and nothing is missing — the row is on the book — so this is
   * the one channel here that raises no exit code. It exists because the CLI is
   * authoritative without a model: the tool result labels outside text for the
   * model in an `untrusted` sidecar, and a reader of `/positions` had nothing.
   */
  altered: Altered[]
  prices: PriceMap
  /** When each price was true. Dropped here, a six-hour-old quote reached the
   *  screen under the two-second `AS OF` of the balance it valued. */
  quotedAt: QuoteTimes
  priceError: string | null
  loadedAt: Date
}

/** What a load is waiting on. A step, not a sentence: the UI does the phrasing. */
export type LoadStep =
  /** `account` only where the venue holds more than one, so the wait names the
   *  address being read rather than repeating a label nothing else could be. */
  | { kind: 'venue'; venue: string; account?: string }
  | { kind: 'prices'; assets: number }

const EMPTY: LoadResult = {
  positions: [],
  failures: [],
  connected: [],
  stale: [],
  altered: [],
  prices: new Map(),
  quotedAt: new Map(),
  priceError: null,
  loadedAt: new Date(0),
}

// Two of the three strings tula did not write are on this screen: a venue's
// error text and an asset symbol. Both are drawn in the tables *and* returned
// to the model as tool results. The symbol is bounded here, the one place every
// connector arrives; the error text is bounded by `remote()` at the connector
// that received it, which is the only place that can tell it from tula's own
// words. The third is the model provider's own error, bounded in
// `src/agent/agent.ts` and never in a tool result. A fourth has to reach
// `SECURITY.md` and the `SOURCES` list in `src/site-claims.test.ts` in the same
// commit — that list is what fails the build when a surface names fewer.
//
// Bounding one quietly is what `LoadResult.altered` exists to stop, and it
// covers the symbol alone. The error text needs no second record: it is already
// on screen as the venue's own words, on a line opening with that venue's id,
// under a block saying the venue failed — the reader knows whose text it is
// reading. A symbol has none of that. It lands in the ASSET column of tula's
// own table, where it reads as tula's own word for the asset.

/**
 * A failure is read as a row, and a break in it reads as a second message. Used
 * on tula's own sentences — a `PartialRead`'s per-chain lines are assembled the
 * same way its joined message is, so both arrive here rather than one of them
 * reaching the screen with its newlines intact.
 */
const flat = (text: string): string => visible(text, ' ').replace(/\s+/g, ' ').trim()

export function reason(err: unknown): string {
  // A `TulaError` is tula's own sentence, and the cap is for somebody else's.
  // Applied to ours it cut the redirect warning — the highest-severity thing
  // tula says — at 200 characters, mid-word, taking the line that says what to
  // do about it off the end. Venue text quoted inside one is already bounded by
  // `remote()` at the connector that received it, which `errors.ts` argues is
  // the only place that can tell the two apart.
  if (err instanceof TulaError) return flat(err.message)
  return remote(err instanceof Error ? err.message : String(err))
}

/**
 * The failure line is prefixed with the venue it is about, so a connector that
 * opens with its own name spells that venue twice: `binance: Binance: HTTP
 * 451`. Kraken's error type omits the prefix for exactly this reason; the other
 * four did not follow, so the rule lives here, where every connector arrives,
 * rather than in four places that have to agree.
 */
function unprefixed(text: string, ...names: string[]): string {
  for (const name of names) {
    const lead = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[:,\\s-]*`, 'i')
    const rest = text.replace(lead, '')
    // A message that was only the name still has to say something.
    if (rest !== '' && rest !== text) return rest
  }
  return text
}

/**
 * A handful of characters in every real listing, and a column in every table
 * that draws one — so the bound is both, and neither alone would do. `slice`
 * counted code units: thirty-two of them is sixteen astral code points, and
 * cutting between the halves of a surrogate pair emitted a lone surrogate into
 * a string that goes to the screen *and* to the model. Thirty-two CJK
 * characters are inside every length bound and sixty-four cells wide, which
 * pushes every column after them off the row.
 */
const MAX_SYMBOL = 32

const clusters = new Intl.Segmenter('en', { granularity: 'grapheme' })

export function symbol(raw: string): string {
  const clean = visible(raw).trim()
  // Every real ticker takes this branch; the walk below is for what does not.
  if (clean.length <= MAX_SYMBOL && cells(clean) === clean.length) return clean

  let out = ''
  let taken = 0
  let width = 0
  for (const { segment } of clusters.segment(clean)) {
    const next = width + cells(segment)
    if (taken === MAX_SYMBOL || next > MAX_SYMBOL) break
    out += segment
    taken += 1
    width = next
  }
  return out
}

/** Venue, chain, reason and bounded name — the whole of what one line reads as. */
const alteredKey = (a: Altered): string => [a.venue, a.chain ?? '', a.why, a.asset].join(' ')

/**
 * What `symbol()` did to a name, or null where it left it alone.
 *
 * Measured against the *composed* form, not the raw one. `visible()` normalizes
 * to NFC before it filters, so a decomposed é comes back a different string with
 * nothing taken out of it — read as removal, every legitimately decomposed
 * ticker would be reported as text somebody hid, and a warning that cries wolf
 * is a warning nobody reads on the day it is real.
 */
export function alteration(raw: string): Alteration | null {
  const bounded = symbol(raw)
  // Said even where the venue sent nothing at all: the ASSET column is blank
  // either way, and a blank one reads as tula failing to fill a field rather
  // than as the whole of the name somebody chose.
  if (bounded === '') return 'empty'
  const composed = raw.normalize('NFC')
  if (visible(raw) !== composed) return 'hidden'
  return bounded === composed.trim() ? null : 'long'
}

/**
 * A row as it enters the book: its symbol bounded, and stamped with the stored
 * credential it came from where the venue holds more than one.
 *
 * The id is rewritten alongside because a connector spells one out of the
 * venue, the kind and the asset — so two addresses on one venue both holding
 * ETH arrive as the same `wallet:spot:ETH`, and anything keyed on it hands one
 * address's liquidation distance to the other's row. `encumbers` names siblings
 * by that same id, so it moves in step or a debt loses the collateral it is
 * margined against.
 */
function attributed(p: Position, account: { id: string; label: string } | undefined): Position {
  const asset = symbol(p.asset)
  if (!account) return asset === p.asset ? p : { ...p, asset }
  return {
    ...p,
    asset,
    id: `${account.id}:${p.id}`,
    ...(p.encumbers ? { encumbers: p.encumbers.map((ref) => `${account.id}:${ref}`) } : {}),
    account,
  }
}

/**
 * Holds one fetch for the length of a shell session so queries are instant.
 * Cached data is never presented as live: every view renders `asOf` from the
 * positions themselves, and `refresh` is explicit.
 */
export class Session {
  private cached: LoadResult = EMPTY
  private hasLoaded = false

  /**
   * Told what the load is on: venues are read in turn, each behind a 15s
   * deadline per request rather than one for the venue — a venue spread over
   * three chains issues many — and a spinner that cannot name the one it is
   * waiting on is indistinguishable from a hang. One listener — there is one
   * shell, and one fetch at a time.
   */
  onProgress: ((step: LoadStep | null) => void) | null = null

  constructor(
    private readonly connectors: Map<string, Connector>,
    private oracle: PriceOracle,
  ) {}

  get priceSource(): string {
    return this.oracle.source
  }

  /** The venue ids a row's label folds back to. */
  get venueIds(): string[] {
    return [...this.connectors.keys()]
  }

  /**
   * Swapping the price source invalidates the cache rather than repricing in
   * place: a book half-priced by one oracle and half by another is exactly the
   * silent inconsistency one-oracle-per-process exists to prevent.
   */
  async useOracle(oracle: PriceOracle): Promise<LoadResult> {
    this.oracle = oracle
    this.hasLoaded = false
    return this.refresh()
  }

  get current(): LoadResult {
    return this.cached
  }

  get isLoaded(): boolean {
    return this.hasLoaded
  }

  async ensureLoaded(): Promise<LoadResult> {
    if (this.hasLoaded) return this.cached
    return this.refresh()
  }

  async refresh(): Promise<LoadResult> {
    try {
      const positions: Position[] = []
      const failures: string[] = []
      const connected: string[] = []
      // Keyed, so one name altered on two rows of a venue — a spot leg and a
      // perp on the same token — is one line to read rather than the same line
      // twice, and a book of a hundred rows cannot bury the block in repeats.
      const altered = new Map<string, Altered>()
      // Every path below that writes a failure line adds the venue here too.
      // The retention after the loop reads which venues did not answer, and
      // deriving that by splitting the lines back apart would be a second
      // parser for a string this file is the one writer of.
      const failed: string[] = []

      for (const venueId of await secrets.listVenues()) {
        const connector = this.connectors.get(venueId)
        if (!connector) {
          failed.push(venueId)
          // A venue tula dropped is not a venue tula never had, and the reader
          // whose key is still on disk is owed the difference: one of these is
          // a decision somebody made about their credential.
          failures.push(
            `${venueId}: ${
              retired(venueId, forgetCommand(venueId)) ??
              `not a venue this build knows — remove it with ${typed(`forget ${venueId}`)}`
            }`,
          )
          continue
        }
        connected.push(venueId)
        const stored = await secrets.listCredentials(venueId)
        if (stored.length === 0) {
          failed.push(venueId)
          failures.push(`${venueId}: nothing stored for it — reconnect with ${connectCommand(venueId)}`)
          continue
        }

        // Named only where there is a second one it could be. On the venue most
        // people have, one address, spelling it out adds forty characters to
        // every failure line and answers a question nobody asked.
        const many = stored.length > 1

        // One venue, whatever it holds: the venue is what the user connected
        // and what every menu, table and status line counts. Which address a
        // row came from is carried on the row instead.
        for (const held of stored) {
          const label = secrets.credentialLabel(held)
          const account = many ? { id: held.id, label } : undefined
          this.onProgress?.(
            account ? { kind: 'venue', venue: venueId, account: label } : { kind: 'venue', venue: venueId },
          )
          // The venue id stays the whole of the prefix: `commands.ts` reads a
          // failure back by it, so an address spelled in front of the colon is
          // a failed venue that renders as one holding nothing.
          const say = (text: string) => {
            failed.push(venueId)
            failures.push(
              `${venueId}: ${account ? `${label} — ` : ''}${unprefixed(text, connector.venue.name, venueId)}`,
            )
          }
          let read: readonly Position[] = []
          try {
            read = await connector.fetchPositions(held.credentials)
          } catch (err) {
            // A venue spread over several chains has several independent ways to
            // fail, and catching per connector made the whole book hostage to
            // whichever public node was rate-limiting: two chains read fine and
            // the reader saw neither. The rows that came back are kept and each
            // chain's failure is its own line, so what is missing is named and
            // what is not missing is still on screen. One address of several is
            // the same shape: the loop carries on to the next one.
            if (err instanceof PartialRead) {
              read = err.positions
              for (const failure of err.failures) say(flat(failure))
            } else say(reason(err))
          }
          for (const p of read) {
            const why = alteration(p.asset)
            if (why !== null) {
              const entry: Altered = {
                venue: venueId,
                asset: symbol(p.asset),
                why,
                ...(p.chain ? { chain: p.chain } : {}),
              }
              altered.set(alteredKey(entry), entry)
            }
            positions.push(attributed(p, account))
          }
        }
      }

      // A venue that failed and returned nothing keeps the rows it last
      // returned. Dropping them made a refresh the one act that could shrink
      // the book: a total read a minute ago fell by that venue's whole value,
      // under an `INCOMPLETE` that says a venue is missing and not that its
      // holdings have just left the sum — and where every venue failed, the
      // reader was left with no book at all rather than the one they had.
      //
      // Nothing here is presented as current: each row carries the `asOf` it
      // was received with, so it dates itself in every table that draws it, and
      // `stale` names the venue so the note above the table can say it in words.
      //
      // Only where nothing at all came back from it. A venue that answered in
      // part — one chain of three, one address of two — has fresh rows on the
      // book already, and a previous row beside them is the same holding twice
      // with one of the two wrong, which is worse than the gap it fills.
      const stale: string[] = []
      for (const venueId of new Set(failed)) {
        if (positions.some((p) => belongsToVenue(p.venue, venueId))) continue
        const previous = this.cached.positions.filter((p) => belongsToVenue(p.venue, venueId))
        if (previous.length === 0) continue
        stale.push(venueId)
        positions.push(...previous)
        // The rows are the previous read's, and so is what was altered in them.
        // Dropped here, a venue whose name was cleaned last minute goes quiet
        // the moment it stops answering — the row still on screen, the account
        // of why it is spelled that way gone with the read that noticed.
        for (const was of this.cached.altered) {
          if (was.venue === venueId) altered.set(alteredKey(was), was)
        }
      }

      // Retained rows are priced with the rest: what could not be re-read is
      // the quantity, not the price, and `netExposure` already takes the older
      // of a row's own `asOf` and the quote's.
      const assets = [...new Set(positions.map((p) => p.asset))]
      let prices: PriceMap = new Map()
      let quotedAt: QuoteTimes = new Map()
      let priceError: string | null = null
      if (assets.length > 0) {
        this.onProgress?.({ kind: 'prices', assets: assets.length })
        try {
          const quotes = await this.oracle.quoteMany(assets)
          prices = new Map([...quotes].map(([asset, q]) => [asset, q.price] as [AssetId, Decimal]))
          quotedAt = new Map([...quotes].map(([asset, q]) => [asset, q.asOf] as [AssetId, Date]))
        } catch (err) {
          // Prices are a nicety; quantities are the truth. Losing them degrades
          // the view rather than failing it, but it must be said out loud.
          priceError = reason(err)
        }
      }

      this.cached = {
        positions,
        failures,
        connected,
        stale,
        altered: [...altered.values()],
        prices,
        quotedAt,
        priceError,
        loadedAt: new Date(),
      }
      this.hasLoaded = true
      return this.cached
    } finally {
      // Cleared however the load ends, or a label outlives the work it named.
      this.onProgress?.(null)
    }
  }

  exposures() {
    return netExposure(this.cached.positions, this.cached.prices, this.cached.quotedAt)
  }

  stalest(): Date | null {
    return oldest(this.cached.positions, this.cached.quotedAt)
  }
}
