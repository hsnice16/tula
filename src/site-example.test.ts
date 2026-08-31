import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import Decimal from 'decimal.js'
import { netExposure, portfolioValue } from './core/exposure.js'
import { pct, quantity, usd } from './core/format.js'
import type { Position, PositionKind } from './core/position.js'
import { whatBreaksFirst } from './core/risk.js'

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

// The book the page says it is showing: one asset held three ways across three
// venues, which is the claim the whole product rests on.
const BOOK: Position[] = [
  position('kraken', 'spot', 'ETH', '4'),
  position('hyperliquid', 'perp', 'ETH', '-2', { price: d('3412') }),
  position('aave', 'collateral', 'ETH', '4.64', { healthFactor: d('1.37') }),
  position('wallet', 'spot', 'USDC', '1200'),
  position('kraken', 'spot', 'USDT', '480'),
]

const PRICES = new Map([
  ['ETH', d('2450')],
  ['USDC', d('1')],
  ['USDT', d('1')],
])

const page = readFileSync(PAGE, 'utf8')
const shows = (text: string) => page.includes(text)

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

  test('publishes no real balance — every figure traces to this book', () => {
    // A number on the page that this book neither states nor produces is a real
    // holding somebody pasted in. CONTRIBUTING forbids exactly that, "including
    // test fixtures and pasted output", and the page is pasted output.
    const bare = (value: string) => value.replace(/[$,%+-]/g, '')
    const exposures = netExposure(BOOK, PRICES)
    const allowed = new Set(
      [
        // Computed here.
        ...exposures.flatMap((e) => [quantity(e.delta), usd(e.notional)]),
        ...whatBreaksFirst(BOOK, PRICES).map((r) => pct(r.move!)),
        usd(portfolioValue(exposures).total),
        // Stated by the book itself: a liquidation price and a health factor are
        // inputs the venue gave us, and the table prints them beside the move.
        ...BOOK.flatMap((p) => [
          quantity(p.quantity),
          p.liquidation?.price?.toFixed(2) ?? '',
          p.liquidation?.healthFactor?.toFixed(2) ?? '',
        ]),
      ].map(bare),
    )

    const terminal = page.slice(page.indexOf('ASSET'), page.indexOf('</Terminal>'))
    const figures = terminal.match(/\d[\d,]*\.\d+/g) ?? []
    expect(figures.length).toBeGreaterThan(5)
    for (const figure of figures) {
      expect({ figure, allowed: allowed.has(bare(figure)) }).toEqual({ figure, allowed: true })
    }
  })
})
