import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Decimal from 'decimal.js'
import type { RiskEngine } from './agent/engine.js'
import { executeTool, TOOLS } from './agent/tools.js'
import { riskEngineFor } from './cli/engine-adapter.js'
import { parseCommand, SLASH_COMMANDS } from './cli/registry.js'
import { Session } from './cli/session.js'
import { dispatchCommand } from './cli/shell.js'
import type { Connector, KeyScope } from './connectors/types.js'
import type { Position, PositionKind } from './core/position.js'
import type { PriceOracle, Quote } from './core/prices.js'
import * as secrets from './secrets/store.js'

/**
 * One book, every command and every tool, asserted against each other.
 *
 * Every other suite here tests one surface alone. N surfaces over one book need
 * N² agreement and N was tested, so each of these shipped green: `shock` said
 * "nothing liquidates" about a position `breaks` called liquidatable now,
 * `/exposure` and `get_net_exposure` named venues differently, and `/refresh`
 * and `/exposure` exited 0 and 1 about the same failed venue. None of them is a
 * wrong number in isolation; every one of them is two answers to one question,
 * and the reader has nothing to decide between them with.
 *
 * The book below is built out of the cases that make surfaces disagree — an
 * asset nobody priced, a perp the venue gave no liquidation data for, a venue
 * that failed, sub-account labels, and a venue connected and holding nothing.
 */

const PRICES: Record<string, number> = { ETH: 4000, SOL: 200, WBTC: 60000, USDC: 1, PYUSD: 1 }

/** XYZ is deliberately absent: an unpriced asset is one of the cases. */
const oracle: PriceOracle = {
  source: 'consistency',
  async quote(asset) {
    const price = PRICES[asset]
    return price === undefined ? null : { price: new Decimal(price), asOf: new Date() }
  },
  async quoteMany(assets) {
    const out = new Map<string, Quote>()
    for (const asset of assets) {
      const price = PRICES[asset]
      if (price !== undefined) out.set(asset, { price: new Decimal(price), asOf: new Date() })
    }
    return out
  },
}

const AS_OF = new Date(Date.now() - 3000)

function at(
  venue: string,
  kind: PositionKind,
  asset: string,
  quantity: string,
  extra: Partial<Position> = {},
): Position {
  const q = new Decimal(quantity)
  return { id: `${venue}:${kind}:${asset}`, venue, kind, asset, quantity: q, delta: q, asOf: AS_OF, ...extra }
}

function connector(
  id: string,
  name: string,
  kind: Connector['venue']['kind'],
  fetch: () => Promise<Position[]>,
): Connector {
  return {
    venue: { id, kind, name },
    fields: [{ name: 'address', label: 'Public address', secret: false }],
    help: [{ label: 'Docs', url: 'https://example.invalid/docs' }],
    async verifyScope(): Promise<KeyScope> {
      return { canRead: true, canTrade: false, canWithdraw: false }
    },
    fetchPositions: fetch,
  }
}

/**
 * A cex whose rows carry sub-account labels, holding an unpriced asset, a
 * priced holding smaller than either column can print, and a perp already past
 * its liquidation price. `alpha-margin` is the label the venue writes; `alpha`
 * is the venue the user connected, and every surface has to agree on which of
 * the two it is naming.
 */
const alpha = connector('alpha', 'Alpha', 'cex', async () => [
  at('alpha-spot', 'spot', 'ETH', '2.5'),
  at('alpha-spot', 'spot', 'XYZ', '7'),
  at('alpha-spot', 'spot', 'PYUSD', '0.000000001'),
  at('alpha-margin', 'perp', 'ETH', '1.5', { liquidation: { price: new Decimal('4200') } }),
])

/** A perp venue that gave no liquidation data at all — not the same as safe. */
const beta = connector('beta', 'Beta', 'perp-dex', async () => [at('beta', 'perp', 'SOL', '-30')])

/** Two collateral legs in one market: a shock on one moves the base by its share. */
const gamma = connector('gamma', 'Gamma', 'lending', async () => [
  at('gamma', 'collateral', 'ETH', '10', {
    liquidation: { healthFactor: new Decimal('1.42'), liquidationThreshold: new Decimal('0.83') },
  }),
  at('gamma', 'collateral', 'WBTC', '0.5', {
    liquidation: { healthFactor: new Decimal('1.42'), liquidationThreshold: new Decimal('0.78') },
  }),
  at('gamma', 'debt', 'USDC', '-18000', { encumbers: ['gamma:collateral:ETH'] }),
])

/** Connected and holding nothing. Not a failure, and not an absence either. */
const delta = connector('delta', 'Delta', 'cex', async () => [])

const epsilon = connector('epsilon', 'Epsilon', 'cex', async () => {
  throw new Error('the venue did not answer')
})

const CONNECTORS = new Map<string, Connector>(
  [alpha, beta, gamma, delta, epsilon].map((c) => [c.venue.id, c]),
)

const WHOLE_BOOK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']

interface Book {
  session: Session
  engine: RiskEngine
  run: (line: string) => Promise<{ output: string; incomplete: boolean }>
  tool: (name: string, input?: unknown) => Record<string, unknown>
}

async function book(venues: string[], connectors: Map<string, Connector> = CONNECTORS): Promise<Book> {
  // Pinned per book and re-set on every call. The store is reached through one
  // process-wide directory, so a second book silently repointed the first at
  // its own credentials — and `/refresh` then answered about the wrong one.
  const dir = await mkdtemp(join(tmpdir(), 'tula-consistency-'))
  const use = (): void => {
    process.env['TULA_CONFIG_DIR'] = dir
  }
  use()
  // Indexed, so the same venue named twice is that venue watching two
  // addresses rather than the same one refused as a duplicate.
  for (const [at, id] of venues.entries()) await secrets.put(id, { address: `0x${id}${at}` })
  const session = new Session(connectors, oracle)
  await session.ensureLoaded()
  const engine = riskEngineFor(session)
  const entries = venues.map((id) => ({ id, connected: true, detail: '' }))
  return {
    session,
    engine,
    run: async (line) => {
      use()
      const parsed = parseCommand(line, [...connectors.keys()])
      if (!parsed) throw new Error(`not a command: ${line}`)
      const result = await dispatchCommand(session, connectors, parsed, entries)
      if (result.kind !== 'output') throw new Error(`${line} did not answer with output`)
      // The one-shot CLI exits non-zero on either, so they are one condition here.
      return { output: result.output, incomplete: Boolean(result.incomplete || result.usageError) }
    },
    tool: (name, input) => {
      use()
      return executeTool(engine, name, input ?? {}) as Record<string, unknown>
    },
  }
}

/**
 * A rendered table back into cells. Columns are joined with two spaces and no
 * cell here holds a run of two, so this reads exactly what the terminal shows —
 * which is the point: the comparison has to be against the screen, not against
 * the value the screen was built from.
 */
function tableRows(output: string, columns: number): string[][] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('─'))
    .map((line) => line.split(/ {2,}/))
    .filter((cells) => cells.length === columns)
    .slice(1)
}

/**
 * `/positions` grows FREE and UNAVAILABLE wherever a holding is held, which
 * this book's pledged collateral leg guarantees. Stated once so a change to the
 * table is one number here rather than a suite that silently matches no rows.
 */
const POSITION_COLUMNS = 7

const rowsOf = (result: Record<string, unknown>, key: string): Record<string, unknown>[] =>
  (result[key] ?? []) as Record<string, unknown>[]

/** The label a venue's own row carries, rebuilt from what the tool split apart. */
const label = (row: Record<string, unknown>): string =>
  (row['sub_account'] as string | undefined) ?? (row['venue'] as string)

let whole: Book
let clean: Book

beforeAll(async () => {
  whole = await book(WHOLE_BOOK)
  // The same book with the failing venue never connected, so "they agree" is a
  // claim about both states rather than about one of them.
  clean = await book(['alpha', 'beta', 'gamma', 'delta'])
})

describe('one holding is one figure, wherever it is read', () => {
  test('a quantity on screen is the quantity the model is handed, digit for digit', async () => {
    const { output } = await whole.run('/positions')
    const screen = new Map(
      tableRows(output, POSITION_COLUMNS).map((r) => [`${r[0]}:${r[1]}:${r[2]}`, r[3] as string]),
    )
    const rows = rowsOf(whole.tool('get_positions'), 'positions')
    expect(rows.length).toBe(screen.size)
    for (const row of rows) {
      const key = `${label(row)}:${row['kind']}:${row['asset']}`
      expect(screen.get(key)).toBe(row['quantity'] as string)
    }
  })

  test('a notional on screen is the notional the model is handed, to the cent', async () => {
    const { output } = await whole.run('/exposure')
    const screen = new Map(tableRows(output, 5).map((r) => [r[0] as string, r[2] as string]))
    const rows = rowsOf(whole.tool('get_net_exposure'), 'exposures')
    expect(rows.length).toBe(screen.size)
    for (const row of rows) {
      const shown = screen.get(row['asset'] as string) ?? '(no row on screen)'
      const given = row['notional_usd'] as string | null
      // An em dash and a null are the same answer spelled for two readers. A
      // `$0.00` on either side is the failure both renderers exist to prevent.
      expect(given === null ? '—' : given).toBe(shown)
    }
  })

  test('a holding too small to print is still a holding on every surface', async () => {
    // Off a real book: `PYUSD 0.000288  $0.00` and `WSTETH 0`, a priced,
    // non-zero balance drawn as one that does not exist. Both surfaces agreed,
    // because both were wrong in the same renderer — and dropping the row
    // instead would be the same wrong answer with nothing left to question.
    const { output } = await whole.run('/positions')
    const shown = tableRows(output, POSITION_COLUMNS).find((r) => r[2] === 'PYUSD')
    expect(shown?.[3]).toBe('<0.00000001')
    const given = rowsOf(whole.tool('get_positions'), 'positions').find(
      (p) => p['asset'] === 'PYUSD',
    )
    expect(given?.['quantity']).toBe('<0.00000001')

    const netted = tableRows((await whole.run('/exposure')).output, 5).find((r) => r[0] === 'PYUSD')
    expect(netted?.[1]).toBe('<0.00000001')
    expect(netted?.[2]).toBe('<$0.01')
  })

  test('an unpriced asset is unpriced on every surface, never a zero on one of them', async () => {
    const rows = rowsOf(whole.tool('get_net_exposure'), 'exposures')
    const nulls = rows.filter((r) => r['notional_usd'] === null).map((r) => r['asset'])
    expect(nulls).toEqual(['XYZ'])
    const { output } = await whole.run('/exposure')
    expect(output).toContain('XYZ')
    expect(output).not.toContain('$0.00')
  })
})

describe('what breaks and what a shock breaks are one answer', () => {
  const SHOCK = { shocks: [{ asset: 'ETH', percent: -10 }] }

  test('a position breaks calls liquidatable now is one the same shock liquidates', () => {
    const risks = rowsOf(whole.tool('what_breaks_first'), 'risks')
    const now = risks.filter((r) => r['move_to_liquidation'] === 'liquidatable now')
    // If the book stops containing one, this suite has stopped testing the case.
    expect(now.length).toBeGreaterThan(0)

    const liquidated = rowsOf(whole.tool('run_scenario', SHOCK), 'liquidated').map(
      (r) => `${label(r)}:${r['kind']}:${r['asset']}`,
    )
    for (const row of now) {
      expect(liquidated).toContain(`${label(row)}:${row['kind']}:${row['asset']}`)
    }
  })

  test('the screen says it too: liquidatable now in breaks is LIQUIDATED in shock', async () => {
    const breaks = await whole.run('/breaks')
    const rows = tableRows(breaks.output, 6).filter((r) => r[3] === 'liquidatable now')
    expect(rows.length).toBeGreaterThan(0)

    const shocked = await whole.run('/shock ETH -10')
    expect(shocked.output).toContain('LIQUIDATED:')
    for (const row of rows) expect(shocked.output).toContain(`${row[0]}  ${row[2]} ${row[1]}`)
  })

  test('a perp with no liquidation data is ranked as unknown, never dropped or called safe', async () => {
    const risks = rowsOf(whole.tool('what_breaks_first'), 'risks')
    const unknown = risks.filter((r) => r['move_to_liquidation'] === null)
    expect(unknown.map((r) => r['asset'])).toEqual(['SOL'])

    // The same row on screen, and the same row named by the scenario as one it
    // could not evaluate — a gap the model is told about rather than a silence
    // it reads as safety.
    const { output } = await whole.run('/breaks')
    expect(tableRows(output, 6).some((r) => r[1] === 'SOL' && r[3] === 'unknown')).toBe(true)
    const gaps = rowsOf(whole.tool('run_scenario', { shocks: [{ asset: 'SOL', percent: -30 }] }), 'could_not_be_evaluated')
    expect(gaps.map((r) => r['asset'])).toEqual(['SOL'])
  })

  test('every rankable position reaches both the table and the tool', async () => {
    const { output } = await whole.run('/breaks')
    const screen = tableRows(output, 6).map((r) => `${r[0]}:${r[1]}:${r[2]}`)
    const tool = rowsOf(whole.tool('what_breaks_first'), 'risks').map(
      (r) => `${label(r)}:${r['asset']}:${r['kind']}`,
    )
    expect(tool).toEqual(screen)
  })

  test('a liquidation row is dated on both surfaces, and to the same second', async () => {
    // Every other view was asserted to carry `as_of` per row; this one was
    // covered only by the column existing. A risk table that has stopped saying
    // when it was true is the staleness rule failing exactly where it matters.
    const { output } = await whole.run('/breaks')
    const screen = new Map(tableRows(output, 6).map((r) => [`${r[0]}:${r[1]}`, r[5] as string]))
    const rows = rowsOf(whole.tool('what_breaks_first'), 'risks')
    expect(rows.length).toBe(screen.size)
    for (const row of rows) {
      const shown = screen.get(`${label(row)}:${row['asset']}`)
      expect(shown).toMatch(/^\d\d:\d\d:\d\d \(\d+[smhd] ago\)$/)
      expect(shown).toBe(row['as_of'] as string)
    }
  })

  test('two shocks at once move both assets, on the screen and in the tool alike', async () => {
    // Simultaneous shocks are the whole point of a cross-venue scenario and
    // every test of them passed one asset, so a second could have been silently
    // dropped anywhere along the path.
    const both = { shocks: [{ asset: 'ETH', percent: -10 }, { asset: 'SOL', percent: -25 }] }
    const tool = whole.tool('run_scenario', both)
    expect((tool['shocks'] as { asset: string; move: string }[]).map((s) => `${s.asset} ${s.move}`)).toEqual([
      'ETH -10%',
      'SOL -25%',
    ])

    const { output } = await whole.run('/shock ETH -10 SOL -25')
    expect(output).toContain('Scenario: ETH -10%, SOL -25%')
    // One shock alone cannot produce this total, so the figures prove both landed.
    expect(output).toContain(tool['value_after_usd'] as string)
    expect(output).toContain(tool['change_usd'] as string)
  })
})

describe('a venue has one name', () => {
  test('a sub-account label folds back to the connected venue everywhere', () => {
    const status = rowsOf(whole.tool('get_venue_status'), 'venues').map((v) => v['venue'])
    for (const row of [
      ...rowsOf(whole.tool('get_positions'), 'positions'),
      ...rowsOf(whole.tool('what_breaks_first'), 'risks'),
    ]) {
      // The venue named to somebody deciding where to act is one they connected.
      expect(status).toContain(row['venue'] as string)
      expect(WHOLE_BOOK).toContain(row['venue'] as string)
    }
  })

  test('the label the screen prints is the one the tool splits in two, not a third spelling', async () => {
    const { output } = await whole.run('/positions')
    const screen = new Set(tableRows(output, POSITION_COLUMNS).map((r) => r[0] as string))
    const rows = rowsOf(whole.tool('get_positions'), 'positions')
    expect(new Set(rows.map(label))).toEqual(screen)
  })

  test('net exposure names venues the venue table also lists', async () => {
    const listed = new Set(tableRows((await whole.run('/venues')).output, 4).map((r) => r[0] as string))
    for (const row of rowsOf(whole.tool('get_net_exposure'), 'exposures')) {
      for (const venue of row['venues'] as string[]) expect(listed).toContain(venue)
    }
  })

  /**
   * Live when this suite was written: `riskEngineFor` built its venue rows by
   * walking positions, so a venue that returned none had no row at all — while
   * `/venues` listed it as "connected, holding nothing", and `get_venue_status`
   * reads an empty list as nothing being connected at all. The model was told a
   * venue the reader was looking at did not exist. The adapter is handed the
   * connected ids now rather than inferring them from what came back.
   */
  test('a venue connected and holding nothing is on screen and in the tool alike', async () => {
    const { output } = await whole.run('/venues')
    expect(tableRows(output, 4).some((r) => r[0] === 'delta')).toBe(true)
    const named = rowsOf(whole.tool('get_venue_status'), 'venues').map((v) => v['venue'])
    expect(named).toContain('delta')
  })
})

describe('one health factor per market, whoever is asking', () => {
  const SHOCK = { shocks: [{ asset: 'ETH', percent: -10 }] }

  /**
   * The disagreement this describes was live when the suite was written:
   * `commands.shock` weighted the shock by the shocked *leg*, one line per leg,
   * while `run_scenario` weighted it by that leg's share of the market's whole
   * collateral base, one row per market. Over gamma's two legs the screen said
   * 1.42 -> 1.28 and the model was handed 1.42 -> 1.34 — two answers about the
   * number this product exists to state, with nothing to choose between them.
   * Both now read `shockedHealthFactors`.
   */
  test('the factor on screen is the factor the model is handed', async () => {
    const { output } = await whole.run('/shock ETH -10')
    const screen = output
      .split('\n')
      .flatMap((line) => {
        const m = /^ {2}(\S+) {2}health factor (\S+) -> (\S+)$/.exec(line)
        return m ? [{ venue: m[1], before: m[2], after: m[3] }] : []
      })
    const tool = rowsOf(whole.tool('run_scenario', SHOCK), 'health_factors').map((r) => ({
      venue: label(r),
      before: r['health_factor_before'] as string,
      after: r['health_factor_after'] as string,
    }))
    expect(screen).toEqual(tool)
  })

  /**
   * The factor holds the debt at today's value — a stablecoin borrow, not a
   * same-asset one — and that was stated in a comment on `healthFactorUnder`
   * and nowhere a reader could reach. gamma borrows USDC, so a shock on USDC
   * moves the debt and not the collateral: the factor prints unchanged, which
   * is the wrong number this says out loud.
   */
  test('a market that borrows what the shock moves says so on screen and to the model alike', async () => {
    const { output } = await whole.run('/shock USDC -10')
    expect(output).toContain('gamma borrows USDC, which this shock moves')
    const rows = rowsOf(whole.tool('run_scenario', { shocks: [{ asset: 'USDC', percent: -10 }] }), 'health_factors')
    expect(rows.map((r) => r['debt_this_shock_moves'])).toEqual([['USDC']])
    expect(rows.map((r) => r['real_health_factor_after'])).toEqual(['higher'])
  })

  test('and neither says it of a shock the market has borrowed nothing of', async () => {
    const { output } = await whole.run('/shock ETH -10')
    expect(output).not.toContain('which this shock moves')
    const rows = rowsOf(whole.tool('run_scenario', SHOCK), 'health_factors')
    expect(rows.map((r) => r['debt_this_shock_moves'])).toEqual([null])
  })
})

describe('a book missing a venue says so on every surface', () => {
  const EVERY_VIEW = [
    '/positions',
    '/exposure',
    '/breaks',
    '/shock ETH -10',
    '/refresh',
    '/gamma breaks',
    '/gamma positions',
  ]

  test('a failed venue is named on screen wherever a figure is', async () => {
    for (const line of EVERY_VIEW) {
      const { output } = await whole.run(line)
      expect(output).toContain('epsilon: the venue did not answer')
    }
    expect((await whole.run('/venues')).output).toContain('epsilon')
  })

  test('every tool result carries the same failure the screen carries', () => {
    for (const name of TOOLS.map((t) => t.name)) {
      const result = whole.tool(name, { shocks: [{ asset: 'ETH', percent: -10 }] })
      const failed =
        name === 'get_venue_status'
          ? (result['failed_venues'] as string[])
          : ((result['incomplete'] as Record<string, unknown>)['failed_venues'] as string[])
      expect(failed).toEqual(['epsilon: the venue did not answer'])
    }
  })

  test('a filtered view is still told the book behind it is short', async () => {
    // The one that shipped wrong: `/gamma breaks` found nothing to liquidate at
    // gamma and said so, about a book with a venue missing from it.
    const { output, incomplete } = await whole.run('/gamma breaks')
    expect(incomplete).toBe(true)
    expect(output).toContain('INCOMPLETE')
  })

  test('the assets left out of a total are the same list in both places', async () => {
    const { output } = await whole.run('/shock ETH -10')
    const excluded = whole.tool('run_scenario', {
      shocks: [{ asset: 'ETH', percent: -10 }],
    })['unpriced_and_excluded'] as string[]
    expect(excluded).toEqual(['XYZ'])
    for (const asset of excluded) expect(output).toContain(asset)
    expect(output).toContain('excluded from the total')
  })
})

describe('one condition, one exit code', () => {
  test('every view that reads a failed book exits non-zero, refresh included', async () => {
    for (const line of ['/positions', '/exposure', '/breaks', '/shock ETH -10', '/refresh', '/venues', '/gamma breaks']) {
      expect({ line, incomplete: (await whole.run(line)).incomplete }).toEqual({ line, incomplete: true })
    }
  })

  test('the same views over a book that read cleanly all exit zero', async () => {
    for (const line of ['/positions', '/exposure', '/breaks', '/shock ETH -10', '/refresh', '/venues', '/gamma breaks']) {
      expect({ line, incomplete: (await clean.run(line)).incomplete }).toEqual({ line, incomplete: false })
    }
  })

  test('a key stored for a venue this build dropped is never reported as a venue that failed', async () => {
    // `circle` is a real id in the retired table, so this reads the shipped
    // sentence rather than a fixture's. Removed and failed are two different
    // things and the reader must not have to work out which they are looking at.
    const dropped = await book(['circle', 'delta'])
    for (const line of ['/positions', '/exposure', '/breaks', '/refresh', '/venues']) {
      const { output } = await dropped.run(line)
      expect({ line, removed: output.includes('REMOVED') }).toEqual({ line, removed: true })
      expect({ line, failed: output.includes('INCOMPLETE') }).toEqual({ line, failed: false })
    }
  })

  test('every view agrees that a dropped venue leaves the book short, refresh included', async () => {
    // The decision this pins, so it cannot drift into two answers: a venue this
    // build no longer reads is counted by `isIncomplete`, so the exit is
    // non-zero. The argument the other way — nothing was asked, so nothing
    // failed — is real and unsettled; what may not happen is `tula refresh &&
    // tula exposure` reporting success and then failure over one store.
    const dropped = await book(['circle', 'delta'])
    for (const line of ['/positions', '/exposure', '/breaks', '/refresh', '/venues']) {
      expect({ line, incomplete: (await dropped.run(line)).incomplete }).toEqual({
        line,
        incomplete: true,
      })
    }
  })

  test('an unpriced asset shortens a total without claiming a venue failed', async () => {
    // Two different gaps. Collapsing them makes a working book exit non-zero
    // every time a price source has never heard of a token somebody holds.
    const { output, incomplete } = await clean.run('/exposure')
    expect(incomplete).toBe(false)
    expect(output).toContain('XYZ')
    expect(output).not.toContain('INCOMPLETE')
  })
})

/**
 * A second book over venue ids the shipped registry declares coverage for. The
 * fixture venues above are deliberately not in the build, so nothing there can
 * exercise a disclosure read off the real manifests.
 */
const declared = new Map<string, Connector>(
  [
    connector('aave', 'Aave', 'lending', async () => [
      at('aave', 'collateral', 'ETH', '10', {
        liquidation: { healthFactor: new Decimal('2.5'), liquidationThreshold: new Decimal('0.83') },
      }),
      at('aave', 'debt', 'USDC', '-8000', { encumbers: ['aave:collateral:ETH'] }),
    ]),
    connector('kraken', 'Kraken', 'cex', async () => [at('kraken', 'spot', 'USD', '1000')]),
  ].map((c) => [c.venue.id, c] as [string, Connector]),
)

describe('how much of a holding can move is one answer', () => {
  let partly: Book

  beforeAll(async () => {
    partly = await book(['aave', 'kraken'], declared)
  })

  test('the free figure on screen is the free figure the model is handed', async () => {
    const { output } = await partly.run('/positions')
    const screen = new Map(
      tableRows(output, POSITION_COLUMNS).map((r) => [`${r[0]}:${r[1]}:${r[2]}`, r]),
    )
    const rows = rowsOf(partly.tool('get_positions'), 'positions')
    expect(rows.length).toBe(screen.size)
    for (const row of rows) {
      const shown = screen.get(`${label(row)}:${row['kind']}:${row['asset']}`)
      const given = row['free_to_move'] as string | null | undefined
      // An em dash and a null are the same answer spelled for two readers, and
      // a row with no free figure at all — a debt — is an em dash on both.
      expect(shown?.[4]).toBe(given === null || given === undefined ? '—' : given)
    }
  })

  test('what is unavailable is the same quantity and the same reason on both', async () => {
    const { output } = await partly.run('/positions')
    const screen = new Map(
      tableRows(output, POSITION_COLUMNS).map((r) => [`${r[0]}:${r[1]}:${r[2]}`, r[5] as string]),
    )
    const rows = rowsOf(partly.tool('get_positions'), 'positions').filter((r) => r['unavailable'])
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const because = row['unavailable_because'] as { reason: string; released_by: string }[]
      expect(screen.get(`${label(row)}:${row['kind']}:${row['asset']}`)).toBe(
        `${row['unavailable']} ${because.map((c) => c.reason).join(', ')}`,
      )
      // The reason with no way out of it is the dead end both surfaces refuse.
      for (const claim of because) expect(claim.released_by.length).toBeGreaterThan(10)
    }
  })

  test('a balance whose hold the venue never reports is unknown on both, never the total', async () => {
    const { output } = await partly.run('/positions')
    const usd = tableRows(output, POSITION_COLUMNS).find((r) => r[2] === 'USD')
    expect(usd?.[4]).toBe('—')
    const row = rowsOf(partly.tool('get_positions'), 'positions').find((r) => r['asset'] === 'USD')
    expect(row?.['free_to_move']).toBeNull()
    expect(row?.['free_to_move_unknown_because']).toContain('Kraken')
  })

  test('a pledged holding is still the whole holding in every exposure figure', async () => {
    // The silent one: a free figure that reached `delta` would shrink every
    // exposure in the book by whatever was pledged, on both surfaces at once.
    const eth = rowsOf(partly.tool('get_net_exposure'), 'exposures').find((e) => e['asset'] === 'ETH')
    expect(eth?.['net_quantity']).toBe('10')
    expect((await partly.run('/exposure')).output).toContain('$40,000.00')
  })
})

describe('what was never asked for is answered on demand, and on neither surface before', () => {
  let partly: Book

  beforeAll(async () => {
    partly = await book(['aave', 'kraken'], declared)
  })

  /**
   * The rule this block holds: a gap that closes gets a line on every view, a
   * gap that does not gets a command. `INCOMPLETE` and `REMOVED` name states
   * that end — a venue comes back, a key is forgotten. Coverage does not: a
   * read-only tool has unbounded uncovered surface, so a count beside every
   * figure never reaches zero, and a block read as wallpaper takes the two
   * lines that *are* about today's money with it.
   */
  test('no routine view carries it, so the block a reader must read stays worth reading', async () => {
    for (const line of ['/positions', '/exposure', '/breaks', '/shock ETH -10', '/refresh']) {
      expect((await partly.run(line)).output).not.toContain('NOT READ')
      expect((await partly.run(line)).output).not.toContain('never asked for')
    }
  })

  test('no tool result carries it either, so the model cannot narrate what the screen does not', async () => {
    // The two surfaces have to be short of the same things. A caveat the model
    // volunteers over a table that carries none is the same book described two
    // ways, which is what this whole file exists to stop.
    for (const name of TOOLS.map((t) => t.name).filter((n) => n !== 'get_venue_status')) {
      const result = partly.tool(name, { shocks: [{ asset: 'ETH', percent: -10 }] })
      expect(result['not_read']).toBeUndefined()
    }
    expect((await partly.run('/positions')).output).not.toContain('NOT READ')
  })

  test('/venues names every area, and get_venue_status hands the model the same list', () => {
    const areas = partly.tool('get_venue_status')['never_asked_for'] as { venue: string }[]
    expect([...new Set(areas.map((a) => a.venue))]).toEqual(['aave', 'kraken'])
    expect(areas.length).toBeGreaterThan(0)
  })

  test('the areas /venues prints are the areas the model can name, one for one', async () => {
    const areas = partly.tool('get_venue_status')['never_asked_for'] as { area: string }[]
    const shown = (await partly.run('/venues')).output
    expect(shown).toContain('Never asked for')
    // Every one of them, not a count: the command is now the whole of the
    // disclosure rather than the place a count sent the reader.
    for (const { area } of areas) expect(shown).toContain(area)
  })

  /**
   * The one exception, and the reason it is one: `breaks` and `shock` claim
   * more than the views that state a quantity. They say what can be called in,
   * in order — so a venue in the book with an unread area that could hold a
   * liquidation of its own makes that order wrong rather than short, and an
   * order that is wrong about what breaks first is the answer this product
   * exists to get right.
   */
  test('the commands that rank a liquidation say what the ranking could not see', async () => {
    for (const line of ['/breaks', '/shock ETH -10']) {
      const { output } = await partly.run(line)
      expect(output).toContain('Ranked over what tula reads')
      expect(output).toContain('aave')
    }
  })

  test('and the two that only state a quantity still say nothing', async () => {
    for (const line of ['/positions', '/exposure']) {
      expect((await partly.run(line)).output).not.toContain('Ranked over what tula reads')
    }
  })

  test('the model is handed it on exactly those two results and no others', async () => {
    const carries = (name: string): boolean =>
      partly.tool(name, { shocks: [{ asset: 'ETH', percent: -10 }] })[
        'unranked_liquidation_sources'
      ] !== undefined
    expect(TOOLS.map((t) => t.name).filter(carries).sort()).toEqual([
      'run_scenario',
      'what_breaks_first',
    ])
  })

  test('the venues it names are the venues the screen names', () => {
    // A caveat one surface makes and the other does not is one book described
    // two ways, which is the whole of what this file is for.
    const said = partly.tool('what_breaks_first')['unranked_liquidation_sources'] as {
      venues: string[]
    }
    expect(said.venues).toEqual(['aave', 'kraken'])
  })

  test('a book with nothing unread says nothing, on either surface', async () => {
    // The fixture venues have no manifest in the build, so this is the state
    // where `/venues` has to fall silent rather than print "0 areas".
    expect((await whole.run('/venues')).output).not.toContain('Never asked for')
    expect(whole.tool('get_venue_status')['never_asked_for']).toEqual([])
    expect((await whole.run('/breaks')).output).not.toContain('Ranked over what tula reads')
    expect(whole.tool('what_breaks_first')['unranked_liquidation_sources']).toBeUndefined()
  })
})

describe('a venue watching two addresses is one book on both surfaces', () => {
  let twice: Book

  beforeAll(async () => {
    twice = await book(['aave', 'aave'], declared)
  })

  test('the account on screen is the account the model is handed', async () => {
    // The venue says where to act and the account says what to act on. Two
    // wallets at one venue rank as rows spelled identically otherwise, so a
    // screen and a model naming them differently is two books.
    const { output } = await twice.run('/positions')
    const screen = tableRows(output, POSITION_COLUMNS + 1).map((r) => r[1] as string)
    const rows = rowsOf(twice.tool('get_positions'), 'positions').map((r) => r['account'] as string)
    expect(new Set(screen)).toEqual(new Set(rows))
    expect(new Set(rows).size).toBe(2)
  })

  test('a liquidation distance names the same address in the table and in the tool', async () => {
    const { output } = await twice.run('/breaks')
    const screen = tableRows(output, 7).map((r) => `${r[1]}:${r[2]}`)
    const rows = rowsOf(twice.tool('what_breaks_first'), 'risks').map(
      (r) => `${r['account']}:${r['asset']}`,
    )
    expect(screen).toHaveLength(2)
    expect(rows).toEqual(screen)
  })
})

/**
 * A book of its own, because the point is a book where one name did not survive
 * the read intact and every other one did. The venue is `aave` so the row
 * carries a chain, which is what makes the RPC variable the way out.
 */
const tampered = new Map<string, Connector>([
  [
    'aave',
    connector('aave', 'Aave', 'lending', async () => [
      at('aave', 'collateral', 'ET\u202eH', '10', { chain: 'ethereum' }),
      at('aave', 'collateral', 'USDC', '5000', { chain: 'ethereum' }),
    ]),
  ],
])

const EVERY_VIEW = ['/positions', '/exposure', '/breaks', '/shock ETH -10', '/refresh', '/venues']

describe('a name the venue did not spell that way is said to both readers', () => {
  let tainted: Book

  beforeAll(async () => {
    tainted = await book(['aave'], tampered)
  })

  test('the screen names the venue that sent it, and the model is handed the same name', async () => {
    // Two halves of one guarantee. The sidecar tells the model which fields
    // carry outside text; nothing told the person reading the table, and the
    // table is the surface that answers with no API key at all.
    const { output } = await tainted.run('/positions')
    expect(output).toContain('aave  hidden characters removed: ETH')
    const result = tainted.tool('get_positions')
    expect((result['untrusted'] as { fields: string[] }).fields).toContain('positions[].asset')
    expect(rowsOf(result, 'positions').map((r) => r['asset'])).toContain('ETH')
  })

  test('the override that would repaint the row is on neither surface', async () => {
    const OVERRIDE = '\u202e'
    expect((await tainted.run('/positions')).output).not.toContain(OVERRIDE)
    expect(JSON.stringify(tainted.tool('get_positions'))).not.toContain(OVERRIDE)
  })

  test('every view saying it still exits zero: nothing failed and nothing is missing', async () => {
    for (const line of EVERY_VIEW) {
      const { output, incomplete } = await tainted.run(line)
      expect({ line, incomplete }).toEqual({ line, incomplete: false })
      expect({ line, said: output.includes('INCOMPLETE') }).toEqual({ line, said: false })
    }
  })

  test('every view the reader lives on says it, and names the way out on each', async () => {
    for (const line of EVERY_VIEW) {
      const { output } = await tainted.run(line)
      expect({ line, said: output.includes('ALTERED') }).toEqual({ line, said: true })
      expect({ line, out: output.includes('TULA_ETHEREUM_RPC') }).toEqual({ line, out: true })
    }
  })
})

describe('the surfaces this suite claims to cover are all of them', () => {
  test('a new command or tool is put through this book, not merely added', () => {
    // The suite is only worth what it covers. A command added without a line
    // here is a surface back to being tested alone, which is the whole cause.
    const covered = new Set([
      'positions', 'exposure', 'breaks', 'shock', 'venues', 'refresh',
      // No book of their own: they answer about the build, the config or the
      // shell rather than about the positions this fixture holds.
      'about', 'clear', 'exit', 'help', 'login', 'update', 'connect', 'forget',
    ])
    expect(SLASH_COMMANDS.map((c) => c.name).filter((n) => !covered.has(n))).toEqual([])

    const toolsCovered = new Set([
      'get_net_exposure', 'get_positions', 'what_breaks_first', 'run_scenario', 'get_venue_status',
    ])
    expect(TOOLS.map((t) => t.name).filter((n) => !toolsCovered.has(n))).toEqual([])
  })
})
