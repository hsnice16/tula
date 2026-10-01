import Decimal from 'decimal.js'
import type { Availability } from './availability.js'
import { claimed } from './availability.js'
import { priceOf, type PriceMap, type QuoteTimes } from './exposure.js'
import { freshness, marginRatio, pct, price, quantity, ratioFloor, ratioValue, usd, healthFactor } from './format.js'
import { belongsToVenue, type Position } from './position.js'
import { liquidationRisk } from './risk.js'

/**
 * The words that pick one position: its asset first, then anything that tells
 * it from another row of the same asset. In core rather than the command layer
 * because the agent's tool resolves the same words, and two resolvers that
 * disagree answer "which BTC" differently on the screen and in the model.
 */
export function findPositions(book: readonly Position[], words: readonly string[]): Position[] {
  const [asset, ...rest] = words.map((w) => w.toLowerCase())
  if (!asset) return []
  return book.filter((p) => holdsAsset(p, asset) && rest.every((w) => narrows(p, w)))
}

/** Whether a row is the asset a reader named: its symbol in any case, a builder-dex market by its bare name, or the venue's own spelling. */
export const holdsAsset = (p: Position, word: string): boolean => assetWords(p).includes(word.toLowerCase())

/** A builder-dex market answers to its bare name too: `TSLA` for `xyz:TSLA`. */
const assetWords = (p: Position): string[] => {
  const words = [p.asset, p.asset.slice(p.asset.indexOf(':') + 1), ...(p.heldAs ? [p.heldAs] : [])]
  return words.map((w) => w.toLowerCase())
}

/** An account label is `name (0x…)` or either half, so each half is a word. */
const accountWords = (p: Position): string[] =>
  p.account ? p.account.label.split(/[\s()]+/).filter(Boolean) : []

function narrows(p: Position, word: string): boolean {
  if (belongsToVenue(p.venue.toLowerCase(), word)) return true
  const words = [p.kind, ...accountWords(p), ...(p.product ?? '').split(/\s+/), ...(p.heldAs ? [p.heldAs] : [])]
  return words.some((w) => w.toLowerCase() === word)
}

/**
 * The shortest words `findPositions` answers with this row alone, so a list of
 * matches is a list of commands that each run. Built by adding what the reader
 * can see on the row — the venue, then the kind, the account, the product —
 * until nothing else matches, rather than by an id nobody can read off a table.
 */
export function positionWords(p: Position, book: readonly Position[]): string[] {
  const account = p.account ? accountWords(p)[0] : undefined
  const candidates = [
    [p.asset],
    [p.venue],
    [p.kind],
    ...(account ? [[account]] : []),
    ...(p.product ? [p.product.split(/\s+/)] : []),
    ...(p.heldAs && p.heldAs !== p.asset ? [[p.heldAs]] : []),
  ]
  const words: string[] = []
  for (const add of candidates) {
    words.push(...add)
    if (findPositions(book, words).length === 1) return words
  }
  return words
}

/**
 * One labelled figure. `outside` marks a row whose value is a name a venue
 * wrote — its label, product or an asset — rather than a figure tula rendered,
 * so the agent's tool can keep the two apart.
 */
export interface DetailRow {
  label: string
  value: string
  outside?: boolean
}

export interface DetailSection {
  title: string
  rows: DetailRow[]
}

export interface PositionDetail {
  position: Position
  sections: DetailSection[]
  /**
   * What the rows cannot say on their own: the account that liquidates this
   * position, or where a price came from. Sentences of ours.
   */
  notes: string[]
}

export interface DetailContext {
  book: readonly Position[]
  prices: PriceMap
  quotedAt?: QuoteTimes
  availability?: Availability
  now?: Date
}

/**
 * Where a figure is absent. Not a dash alone: a dash in a column of figures is
 * read as "none", and an unstated funding figure is not zero funding.
 */
const NOT_STATED = 'not stated by the venue'

/** In the currency the venue stated it in, where that is not dollars. */
const money = (value: Decimal, currency?: string): string => (currency ? `${quantity(value)} ${currency}` : usd(value))

/**
 * Funding in words, not by sign: Hyperliquid's positive is paid, its app does
 * not say whether it prints that negated, and a sign read the wrong way round
 * turns a cost into income.
 */
const paid = (value: Decimal, currency?: string): string =>
  value.isZero() ? 'none' : `${money(value.abs(), currency)} ${value.isNegative() ? 'received' : 'paid'}`

/** Up is `+`, as every venue prints a PnL. */
export const signedMoney = (value: Decimal, currency?: string): string =>
  `${value.isPositive() && !value.isZero() ? '+' : ''}${money(value, currency)}`

/** The asset as a table's ASSET column prints it, the venue's own spelling beside it. */
export const assetName = (p: Position): string => (p.heldAs ? `${p.asset} (as ${p.heldAs})` : p.asset)

/** A row named on one line, every part a table column would show. */
export const rowName = (p: Position): string => `${p.kind} ${assetName(p)}${p.product ? ` in ${p.product}` : ''}`

/**
 * One position, in sections every kind of venue fills from what it states —
 * a perp, an Aave leg, a Kraken margin book and a wallet balance alike.
 * `tasks/field-report/15-position-detail.md` cites the venues' own labels.
 * A section with nothing to say for this kind of row is left out, not filled
 * with "not stated": an unstated liquidation price on a USDC balance is a row
 * about a trigger the balance does not have.
 */
export function positionDetail(p: Position, context: DetailContext): PositionDetail {
  const now = context.now ?? new Date()
  const f = p.figures
  const params = p.liquidation
  const perp = p.kind === 'perp'
  const notes: string[] = []
  const sections: DetailSection[] = []
  const section = (title: string, rows: DetailRow[]) => {
    if (rows.length > 0) sections.push({ title, rows })
  }

  // The venue's mark where it stated one, so value and PnL are one venue's
  // figures; the price source otherwise, and said to be.
  const oracle = priceOf(context.prices, p.asset)
  const mark = params?.mark ?? oracle
  const markIsVenue = params?.mark !== undefined
  if (!markIsVenue && oracle !== undefined) {
    const at = context.quotedAt?.get(p.asset)
    notes.push(`Value and price are the price source’s${at ? `, as of ${freshness(at, now)}` : ''}${perp ? ', not the venue’s mark' : ''}.`)
  }
  section('Position', [
    { label: 'Size', value: `${quantity(p.quantity)}${perp ? (p.quantity.isNegative() ? ' short' : ' long') : ''}` },
    // A perp's value is its notional, unsigned as every venue prints it; a debt's is owed, so negative.
    { label: 'Value', value: mark === undefined ? 'no price' : usd((perp ? p.quantity.abs() : p.quantity).times(mark)) },
    ...(perp || f?.entry !== undefined
      ? [{ label: 'Entry Price', value: f?.entry === undefined ? NOT_STATED : price(f.entry) }]
      : []),
    { label: markIsVenue ? 'Mark Price' : 'Price', value: mark === undefined ? 'no price' : price(mark) },
  ])

  const pnl = f?.unrealisedPnl
  const funding = f?.funding
  section('PnL', [
    ...(perp || pnl !== undefined
      ? [
          {
            label: 'Unrealised PnL',
            value:
              pnl === undefined
                ? NOT_STATED
                : `${signedMoney(pnl, f?.currency)}${f?.returnOnEquity === undefined ? '' : ` (ROE ${pct(f.returnOnEquity)})`}`,
          },
        ]
      : []),
    ...(perp
      ? [
          {
            label: 'Funding',
            value:
              funding?.sinceOpen === undefined && funding?.allTime === undefined
                ? NOT_STATED
                : [
                    ...(funding.sinceOpen !== undefined ? [`${paid(funding.sinceOpen, f?.currency)} since open`] : []),
                    ...(funding.allTime !== undefined ? [`${paid(funding.allTime, f?.currency)} all time`] : []),
                  ].join(' · '),
          },
        ]
      : []),
  ])

  section('Liquidation', liquidationRows(p, context, notes))
  section('Holding', holdingRows(p, context))
  section('Source', [
    { label: 'Venue', value: p.venue, outside: true },
    ...(p.account ? [{ label: 'Account', value: p.account.label }] : []),
    ...(p.chain ? [{ label: 'Chain', value: p.chain }] : []),
    ...(p.product ? [{ label: 'Product', value: p.product, outside: true }] : []),
    ...(p.heldAs ? [{ label: 'Held As', value: p.heldAs, outside: true }] : []),
    { label: 'As Of', value: freshness(p.asOf, now) },
  ])
  return { position: p, sections, notes }
}

/**
 * What liquidates it. A perp's own price and margin; an account's ratio where
 * the venue liquidates the account instead, with the position's own price said
 * to lie past it; a lending market's health factor; a margin book's leverage
 * where the venue publishes no price. `whatBreaksFirst` ranks by the same split.
 */
function liquidationRows(p: Position, context: DetailContext, notes: string[]): DetailRow[] {
  const params = p.liquidation
  const f = p.figures
  const rows: DetailRow[] = []
  const withAccount = params?.liquidatedWith
  const account = withAccount
    ? context.book.find((row) => row.liquidation?.ratio?.account === withAccount)
    : undefined
  const ratio = account?.liquidation?.ratio ?? params?.ratio

  // Worded as `/breaks` heads the same figure, MOVE TO LIQ, so the two read as one number.
  const distance = (target: Position): string | null => {
    const risk = liquidationRisk(target, context.prices)
    return risk.liquidatable ? 'liquidatable now' : risk.move === null ? null : `${pct(risk.move)} to liquidation`
  }

  if (p.kind === 'perp') {
    const own = ratio ? null : distance(p)
    rows.push({
      label: 'Liq. Price',
      value: params?.price === undefined ? NOT_STATED : `${price(params.price)}${own ? ` (${own})` : ''}`,
    })
  }
  if (f?.margin !== undefined || params?.leverage !== undefined) {
    const leverage = [params?.leverage !== undefined ? `${params.leverage.toString()}x` : '', f?.marginMode ?? '']
      .filter(Boolean)
      .join(' ')
    // Leverage alone is its own row: "Margin: not stated" beside a leverage the
    // venue did state reads as the venue withholding the margin.
    rows.push(
      f?.margin === undefined
        ? { label: 'Leverage', value: leverage }
        : { label: 'Margin', value: `${money(f.margin, f.currency)}${leverage ? ` (${leverage})` : ''}` },
    )
  }

  // A ratio or a health factor moves with what backs the account, not with one
  // price, so its distance says that rather than reading as this asset's move.
  const backing = (target: Position, what: string): string | null => {
    const risk = liquidationRisk(target, context.prices)
    if (risk.liquidatable) return 'liquidatable now'
    return risk.move === null ? null : `${what} can fall ${pct(risk.move.abs()).replace(/^\+/, '')} first`
  }

  if (ratio) {
    const move = backing(account ?? p, 'what backs it')
    rows.push({
      label: ratio.name,
      value: `${ratioValue(ratio)}, liquidated past ${marginRatio(ratio.threshold)}${move ? ` (${move})` : ''}`,
    })
    const floor = ratioFloor(ratio)
    if (floor) notes.push(`The ratio covers what loaded: ${floor}.`)
    notes.push(
      p.kind === 'perp'
        ? `The account is liquidated on its ${ratio.name}, not this position on its own price${params?.price !== undefined ? ', which lies past the account’s trigger' : ''}.`
        : `The account is liquidated as a whole once its ${ratio.name} passes ${marginRatio(ratio.threshold)}.`,
    )
    return rows
  }

  if (params?.healthFactor !== undefined) {
    const move = backing(p, 'collateral')
    rows.push({ label: 'Health Factor', value: `${healthFactor(params.healthFactor)}${move ? ` (${move})` : ''}` })
    if (params.liquidationThreshold !== undefined) {
      rows.push({ label: 'Liq. Threshold', value: marginRatio(params.liquidationThreshold) })
    }
    notes.push('The market is liquidated as a whole once its health factor falls below 1, not this leg alone.')
    return rows
  }

  if (p.kind !== 'perp' && params?.leverage !== undefined && params.price === undefined) {
    notes.push('The venue publishes no liquidation price here and liquidates the account, not the position.')
  } else if (p.kind === 'perp' && p.encumbers?.length && params?.price !== undefined) {
    notes.push('Cross margin: the price moves as the rest of the account does, since one pool backs every cross position.')
  }
  return rows
}

/**
 * What of it can move, what it borrowed, and which rows it is tied to — the
 * margin a perp draws on, the collateral behind a loan. Read off the same
 * `encumbers` links availability and `breaks` read, so a reader can walk from
 * a balance to what it is pledged for without leaving the dialog.
 */
function holdingRows(p: Position, context: DetailContext): DetailRow[] {
  const rows: DetailRow[] = []
  const a = context.availability
  if (a && (a.claims.length > 0 || a.free === null)) {
    rows.push({ label: 'Free', value: a.free === null ? `unknown — ${a.unprovable ?? 'the venue does not state it'}` : quantity(a.free) })
    if (a.claims.length > 0) {
      rows.push({ label: 'Unavailable', value: `${quantity(claimed(a))} ${a.claims.map((c) => c.reason).join(', ')}` })
    }
  }
  const b = p.borrowing
  if (b) {
    rows.push({ label: 'Borrowed', value: quantity(b.borrowed) })
    rows.push({ label: 'Supplied', value: quantity(b.supplied) })
    rows.push({ label: 'LTV', value: marginRatio(b.ltv) })
  }
  // Linked both ways, as a margin position's asset leg and its loan are, the
  // two are one position rather than one backing the other.
  const backs = context.book.filter((row) => row.encumbers?.includes(p.id))
  const backedBy = context.book.filter((row) => p.encumbers?.includes(row.id))
  const paired = backs.filter((row) => backedBy.includes(row))
  const list = (of: Position[]) => of.map(rowName).join(', ')
  if (paired.length > 0) rows.push({ label: 'Paired With', value: list(paired), outside: true })
  const only = (of: Position[]) => of.filter((row) => !paired.includes(row))
  if (only(backs).length > 0) rows.push({ label: 'Backs', value: list(only(backs)), outside: true })
  if (only(backedBy).length > 0) rows.push({ label: 'Backed By', value: list(only(backedBy)), outside: true })
  return rows
}

/** After whatever a view sorts by, so rows that share it keep one order between two reads. */
export const tieBreak = (a: Position, b: Position): number =>
  (a.account?.label ?? '—').localeCompare(b.account?.label ?? '—') ||
  (a.product ?? '').localeCompare(b.product ?? '') ||
  (a.heldAs ?? '').localeCompare(b.heldAs ?? '')

/**
 * The order `/positions` prints in, so the picker lists the rows where the
 * reader just saw them.
 */
export const bookOrder = (a: Position, b: Position): number =>
  a.venue.localeCompare(b.venue) || a.asset.localeCompare(b.asset) || a.kind.localeCompare(b.kind) || tieBreak(a, b)

/** One row in full where the words name one; otherwise every row they name, each with the words that name it alone. */
export interface PositionLookup {
  detail: PositionDetail | null
  matches: { position: Position; words: string[] }[]
}

/**
 * `/position`, the shell's modal and the agent's `get_position` all resolve
 * their words here, so the same words open the same row on every surface.
 */
export function lookupPosition(
  words: readonly string[],
  context: Omit<DetailContext, 'availability'> & { availabilityOf?: (p: Position) => Availability | undefined },
): PositionLookup {
  const { availabilityOf, ...rest } = context
  const found = findPositions(context.book, words).sort(bookOrder)
  const only = found.length === 1 ? found[0] : undefined
  if (!only) return { detail: null, matches: found.map((p) => ({ position: p, words: positionWords(p, context.book) })) }
  const free = availabilityOf?.(only)
  return {
    detail: positionDetail(only, { ...rest, ...(free ? { availability: free } : {}) }),
    matches: [{ position: only, words: positionWords(only, context.book) }],
  }
}

/**
 * The picker's filter: every word typed starts a word on the row. Looser than
 * `findPositions`, which has to name one row, because this narrows a list the
 * reader is still looking at — "eth" is every ETH row, "eth hyp" the one.
 *
 * An asset is read first: "hype" is the HYPE rows, not every row at a venue
 * whose name happens to start with it. Only where a word starts no asset is
 * it read against the venue, kind, account and product.
 */
export function matchPositions(book: readonly Position[], query: string): Position[] {
  const typed = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (typed.length === 0) return [...book]
  const lower = (words: string[]) => words.map((w) => w.toLowerCase()).filter(Boolean)
  const rest = (p: Position) =>
    lower([p.venue, ...p.venue.split('-'), p.kind, ...accountWords(p), ...(p.product ?? '').split(/\s+/)])
  const startsAsset = (p: Position, t: string) => lower(assetWords(p)).some((w) => w.startsWith(t))
  const assetLed = book.filter((p) => typed.every((t) => startsAsset(p, t) || rest(p).includes(t)))
  if (assetLed.length > 0 && typed.some((t) => assetLed.some((p) => startsAsset(p, t)))) return assetLed
  return book.filter((p) => typed.every((t) => startsAsset(p, t) || rest(p).some((w) => w.startsWith(t))))
}
