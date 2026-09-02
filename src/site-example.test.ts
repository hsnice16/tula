import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import Decimal from 'decimal.js'
import { netExposure, portfolioValue } from './core/exposure.js'
import { pct, quantity, usd } from './core/format.js'
import type { Position, PositionKind } from './core/position.js'
import { scenario, whatBreaksFirst } from './core/risk.js'

/**
 * The front page publishes tula's output as its argument for the product, and
 * the argument is that deterministic code computes every figure. A hand-typed
 * number there is the one place the claim can be false in public — it once
 * showed `health factor 1.37` beside `-18.4%` when the engine says -27.0%, and
 * a short perp liquidating on a *fall*.
 *
 * So the page is read as text and its figures recomputed here. This is not an
 * import: `site/` is a separate package whose dependency tree must never join
 * the binary's, and reading a file keeps that true.
 */
const PAGE = 'site/app/page.tsx'

/**
 * The card a link to the site unfurls as. It quotes the same book in the shape
 * a preview has room for, and it is read far more often than the page — a link
 * pasted into a chat is the whole of it for most people, and nobody scrolls
 * past a picture to a correction.
 */
const CARD = 'site/app/og.png/route.tsx'

const d = (v: string) => new Decimal(v)

const at = new Date()
const position = (
  venue: string,
  kind: PositionKind,
  asset: string,
  qty: string,
  liquidation?: Position['liquidation'],
): Position => ({
  id: `${venue}:${kind}:${asset}`,
  venue,
  kind,
  asset,
  quantity: d(qty),
  delta: d(qty),
  asOf: at,
  ...(liquidation ? { liquidation } : {}),
})

// The book the page says it is showing. ETH held three ways across three venues
// is the claim the whole product rests on; the rest is there because a book of
// three assets is not one, and because the page shows ctrl+o holding a line back
// — which the tool only does past twelve rows.
const BOOK: Position[] = [
  position('kraken', 'spot', 'ETH', '4'),
  position('hyperliquid', 'perp', 'ETH', '-2', { price: d('3412') }),
  position('aave', 'collateral', 'ETH', '4.64', { healthFactor: d('1.37') }),
  position('kraken', 'spot', 'BTC', '0.12'),
  position('kraken', 'spot', 'SOL', '30'),
  position('wallet', 'spot', 'LINK', '180'),
  position('wallet', 'spot', 'USDC', '1200'),
  position('wallet', 'spot', 'ARB', '900'),
  position('kraken', 'spot', 'USDT', '480'),
  position('wallet', 'spot', 'OP', '320'),
  position('wallet', 'spot', 'UNI', '60'),
]

const PRICES = new Map([
  ['ETH', d('2450')],
  ['BTC', d('68000')],
  ['SOL', d('145')],
  ['LINK', d('14.20')],
  ['USDC', d('1')],
  ['ARB', d('0.62')],
  ['USDT', d('1')],
  ['OP', d('1.45')],
  ['UNI', d('7.30')],
])

/** The move the question printed beside the answer asks about. */
const SHOCK = [{ asset: 'ETH', pct: d('-0.2') }]

const page = readFileSync(PAGE, 'utf8')
const card = readFileSync(CARD, 'utf8')
const shows = (text: string) => page.includes(text)

/** The tuple rows of a `const X = [...] as const` table, as written. */
const table = (source: string, name: string) => {
  const start = source.indexOf(`const ${name} = [`)
  return source
    .slice(source.indexOf('[', start), source.indexOf('] as const', start))
    .trim()
}

/**
 * The two blocks of the page that quote the tool: the command transcript and
 * the answer to a question asked in plain English. Read separately rather than
 * as one span, because the prose and the panel between them are full of lengths
 * and sizes that look exactly like figures.
 */
const QUOTED = [
  page.slice(page.indexOf('ASSET'), page.indexOf('</Session>')),
  page.slice(page.indexOf('<Ask'), page.indexOf('</Ask>')),
]

describe('the published example', () => {
  test('nets the same figure the engine does', () => {
    const eth = netExposure(BOOK, PRICES).find((e) => e.asset === 'ETH')
    expect(eth).toBeDefined()
    expect(shows(quantity(eth!.delta))).toBe(true)
    expect(shows(usd(eth!.notional))).toBe(true)
  })

  test('totals the same portfolio value', () => {
    const total = portfolioValue(netExposure(BOOK, PRICES)).total
    expect(shows(`Net value  ${usd(total)}`)).toBe(true)
  })

  test('reports the liquidation distances the risk engine computes', () => {
    const risks = whatBreaksFirst(BOOK, PRICES)
    expect(risks.length).toBeGreaterThan(0)
    for (const risk of risks) {
      expect(risk.move).not.toBeNull()
      // Direction included: a short perp liquidates on a rise, and publishing
      // a minus there tells the reader the opposite of what the tool would.
      expect(shows(pct(risk.move!))).toBe(true)
    }
  })

  test('shows a health factor next to the move it actually produces', () => {
    const aave = whatBreaksFirst(BOOK, PRICES).find((r) => r.position.venue === 'aave')
    const hf = aave!.position.liquidation!.healthFactor!
    const row = page.split('\n').find((l) => l.includes(`health factor ${hf.toFixed(2)}`))
    expect(row).toBeDefined()
    expect(row).toContain(pct(aave!.move!))
  })

  test('holds back the line the transcript would hold back', () => {
    // PREVIEW_ROWS in src/ui/app.tsx is twelve: the table's header, its rule, a
    // row per asset and the blank before the total come to exactly that, so the
    // total is the one line ctrl+o has to reveal. The page draws that swap in
    // place, one row either way, and an asset more or fewer here would publish a
    // split the tool would never make.
    const table = page.indexOf('{`ASSET')
    const shown = page.slice(table, page.indexOf('`}', table))
    expect(shown.split('\n').length - 1).toBe(2 + netExposure(BOOK, PRICES).length + 1)

    const total = portfolioValue(netExposure(BOOK, PRICES)).total
    // Biome owns the quote character in the page; the claim here is the wrapper.
    const anyQuote = (text: string) => text.replace(/['"]/g, '"')
    expect(anyQuote(page)).toContain(anyQuote(`<Held>{"Net value  ${usd(total)}"}</Held>`))
  })

  test('answers the question above it with the scenario the engine runs', () => {
    const result = scenario(BOOK, PRICES, SHOCK)
    // Flattened: the answer is hand-wrapped to the frame, and where a line
    // breaks is a layout decision rather than a claim about any figure.
    const answer = QUOTED[1]!.replace(/\s+/g, ' ')
    expect(answer).toContain(usd(result.after.total))
    expect(answer).toContain(usd(result.change))
    // "nothing liquidates" is the load-bearing half of that answer, and it is a
    // claim about this book under this shock — not a safe thing to leave typed.
    expect(result.liquidated).toEqual([])
    expect(answer).toContain('nothing liquidates')
  })

  test('states the venue and position counts of this book', () => {
    // The status line is the frame's claim about what is loaded behind the two
    // answers above it, and it is the one line on the page not computed by a
    // command whose output is quoted directly.
    const venues = new Set(BOOK.map((p) => p.venue)).size
    expect(shows(`${venues} venues  ·  ${BOOK.length} positions`)).toBe(true)
  })

  test('publishes no real balance — every figure traces to this book', () => {
    // A number on the page that this book neither states nor produces is a real
    // holding somebody pasted in. CONTRIBUTING forbids exactly that, "including
    // test fixtures and pasted output", and the page is pasted output.
    const bare = (value: string) => value.replace(/[$,%+-]/g, '')
    const exposures = netExposure(BOOK, PRICES)
    const shocked = scenario(BOOK, PRICES, SHOCK)
    const allowed = new Set(
      [
        // Computed here.
        ...exposures.flatMap((e) => [quantity(e.delta), usd(e.notional)]),
        ...whatBreaksFirst(BOOK, PRICES).map((r) => pct(r.move!)),
        usd(portfolioValue(exposures).total),
        usd(shocked.after.total),
        usd(shocked.change),
        // Stated by the book itself: a liquidation price and a health factor are
        // inputs the venue gave us, and the table prints them beside the move.
        ...BOOK.flatMap((p) => [
          quantity(p.quantity),
          p.liquidation?.price?.toFixed(2) ?? '',
          p.liquidation?.healthFactor?.toFixed(2) ?? '',
        ]),
      ].map(bare),
    )

    const figures = QUOTED.flatMap((block) => block.match(/\d[\d,]*\.\d+/g) ?? [])
    expect(figures.length).toBeGreaterThan(5)
    for (const figure of figures) {
      expect({ figure, allowed: allowed.has(bare(figure)) }).toEqual({ figure, allowed: true })
    }
  })
})

describe('the preview card', () => {
  test('quotes the venue rows the page quotes', () => {
    // Two files draw the same three rows, and only one of them is ever looked
    // at while editing the other.
    expect(table(card, 'ROWS')).toBe(table(page, 'SEEN'))
  })

  test('publishes the netted figure and the distance the risk engine computes', () => {
    const eth = netExposure(BOOK, PRICES).find((e) => e.asset === 'ETH')
    const aave = whatBreaksFirst(BOOK, PRICES).find((r) => r.position.venue === 'aave')
    expect(card).toContain(quantity(eth!.delta))
    expect(card).toContain(pct(aave!.move!))
  })
})
