import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Decimal from 'decimal.js'
import { CONNECTORS } from '../connectors/registry.js'
import type { Connector } from '../connectors/types.js'
import type { Position, PositionKind } from '../core/position.js'
import type { PriceOracle } from '../core/prices.js'
import * as secrets from '../secrets/store.js'
import { cells, wrapLines } from '../ui/wrap.js'
import * as commands from './commands.js'
import { Session } from './session.js'

const AS_OF = new Date(Date.now() - 4000)
const d = (v: string) => new Decimal(v)

const at = (
  venue: string,
  kind: PositionKind,
  asset: string,
  quantity: string,
  extra: Partial<Position> = {},
): Position => {
  const q = d(quantity)
  return { id: `${venue}:${kind}:${asset}`, venue, kind, asset, quantity: q, delta: q, asOf: AS_OF, ...extra }
}

const oracle: PriceOracle = {
  source: 'test',
  async quote() {
    return null
  },
  async quoteMany() {
    return new Map()
  },
}

/**
 * A shipped connector with its own rows. The venue id has to be one the build
 * knows, because what a venue does not read is read off that venue's manifest.
 */
const holding = (id: string, rows: Position[]): Connector => ({
  ...CONNECTORS.get(id)!,
  fetchPositions: async () => rows,
})

async function sessionOver(
  connectors: Map<string, Connector>,
  /** Venues to connect a second address for, so their rows carry an account. */
  twice: string[] = [],
): Promise<Session> {
  process.env['TULA_CONFIG_DIR'] = await mkdtemp(join(tmpdir(), 'tula-commands-'))
  for (const id of connectors.keys()) {
    await secrets.put(id, { address: '0xabc' }, twice.includes(id) ? 'hot' : undefined)
    if (twice.includes(id)) await secrets.put(id, { address: '0xdef' }, 'vault')
  }
  const session = new Session(connectors, oracle)
  await session.ensureLoaded()
  return session
}

const map = (...entries: Connector[]): Map<string, Connector> =>
  new Map(entries.map((c) => [c.venue.id, c]))

/** Nothing pledged, nothing held, and a venue that can prove it. */
const freeBook = () => map(holding('wallet', [at('wallet', 'spot', 'ETH', '2.5')]))

/** Ten ETH securing a loan, and a balance whose hold Kraken will not state. */
const heldBook = () =>
  map(
    holding('aave', [
      at('aave', 'collateral', 'ETH', '10', {
        liquidation: { healthFactor: d('2.5'), liquidationThreshold: d('0.83') },
      }),
      at('aave', 'debt', 'USDC', '-8000', { encumbers: ['aave:collateral:ETH'] }),
    ]),
    holding('kraken', [at('kraken', 'spot', 'USD', '1000')]),
  )

beforeEach(() => {
  process.env['TULA_NO_UPDATE_CHECK'] = '1'
})

describe('how much of this can you move', () => {
  test('an asset entirely free gains no column at all', async () => {
    // The answer would cost more attention than it returns: a wallet holding
    // one token does not need two columns saying nothing is holding it.
    const { output } = await commands.positions(await sessionOver(freeBook()))
    expect(output).not.toContain('FREE')
    expect(output).not.toContain('UNAVAILABLE')
  })

  test('a pledged holding shows the split and what releases it, in the same view', async () => {
    const { output } = await commands.positions(await sessionOver(heldBook()))
    expect(output).toContain('FREE')
    expect(output).toMatch(/\n.*\b6\s+4 securing a debt/)
    expect(output).toContain('repay the debt')
  })

  test('a hold the venue never states is an em dash, never the whole balance', async () => {
    const { output } = await commands.positions(await sessionOver(heldBook()))
    const usd = output.split('\n').find((l) => l.includes('USD') && l.includes('1000'))
    expect(usd).toMatch(/1000\s+—\s+—/)
    expect(output).toContain('free unknown')
  })

  test('the same split is on the venue’s own view, not only the whole book', async () => {
    const session = await sessionOver(heldBook())
    const { output } = await commands.positionsAt(session, 'aave', 'lending')
    expect(output).toContain('UNAVAILABLE')
    expect(output).toContain('securing a debt')
  })

  test('a debt is not offered a free figure of its own', async () => {
    const { output } = await commands.positions(await sessionOver(heldBook()))
    const debt = output.split('\n').find((l) => l.includes('-8000'))
    expect(debt).toMatch(/-8000\s+—\s+—/)
  })

  test('the quantity column is untouched: exposure is not availability', async () => {
    const session = await sessionOver(heldBook())
    const { output } = await commands.positions(session)
    expect(output).toMatch(/collateral\s+ETH\s+10\s/)
  })
})

describe('what the book does not cover, where the book is read', () => {
  test('no view carries it, so the block a reader must read is short and about today', async () => {
    // `INCOMPLETE` and `REMOVED` name a state that ends; coverage does not, and
    // a count beside every figure that never reaches zero teaches the reader to
    // skip the block those two sit in.
    const session = await sessionOver(heldBook())
    for (const result of [
      await commands.positions(session),
      await commands.exposure(session),
      await commands.breaks(session),
      await commands.shock(session, ['ETH', '-10']),
    ]) {
      expect(result.output).not.toContain('NOT READ')
      expect(result.output).not.toContain('never asked for')
    }
  })

  test('a venue that answered in part is not a failure, so nothing exits non-zero', async () => {
    // Unchanged by where the disclosure moved to: counted as a failure it would
    // break every script that reads an exit code.
    const result = await commands.positions(await sessionOver(heldBook()))
    expect(result.incomplete).toBe(false)
  })

  test('the sentence stays a sentence whether there are two possibilities or three', async () => {
    // The `or` belongs before the last item, and the last item moves. Written
    // as a fixed part of the second clause it vanished from the two-item form:
    // "Either the account is empty, it is not the one you trade with."
    const withGap = await commands.positions(await sessionOver(map(holding('aave', []))))
    expect(withGap.output).toContain('empty, it is not the one you trade with,')
    expect(withGap.output).toContain('or what it holds is in a part of aave')

    // A venue the registry has no manifest for, which is the only way to reach
    // the two-item form: every venue this build ships declares something.
    const base = CONNECTORS.get('aave')!
    const stranger: Connector = {
      ...base,
      venue: { ...base.venue, id: 'stranger' },
      fetchPositions: async () => [],
    }
    const noGap = await commands.positions(await sessionOver(map(stranger)))
    expect(noGap.output).toContain('empty, or it is not the one you trade with.')
  })

  test('an empty book names the third possibility, not just the two that are wrong', async () => {
    // The founding case, and it was the one screen that never said it: connect
    // Aave, hold everything on V4, and the whole book comes back empty. Offered
    // only "empty, or not the account you trade with" the reader goes and
    // re-checks an address that was right the whole time.
    const session = await sessionOver(map(holding('aave', [])))
    const { output } = await commands.positions(session)
    expect(output).toContain('returned nothing')
    expect(output).toContain('or what it holds is in a part of aave nothing here reads')
  })

  test('a venue nobody connected is not handed a list of what it does not read', async () => {
    // Not connected is a decision, not a gap. The screen for one is an offer to
    // connect it, and a list of everything it would still miss is nagging.
    const session = await sessionOver(freeBook())
    const { output } = await commands.venueStatus(session, CONNECTORS.get('binance')!, false)
    expect(output).toContain('Not connected')
    expect(output).not.toContain('Never asked for')
  })

  test('/venues is where the whole of it is, named area by area', async () => {
    const session = await sessionOver(heldBook())
    const { output } = await commands.venues(session, heldBook())
    expect(output).toContain('Aave V4')
    expect(output).toContain('Never asked for')
  })

  test('a venue’s own status screen says what nothing reads there', async () => {
    const session = await sessionOver(heldBook())
    const { output } = await commands.venueStatus(session, CONNECTORS.get('kraken')!, true)
    expect(output).toContain('Kraken Futures positions')
    expect(output).toContain('hides what you can move')
  })

  test('every line of it fits the narrowest width the shell supports', async () => {
    const session = await sessionOver(heldBook())
    const { output } = await commands.venues(session, heldBook())
    for (const row of wrapLines(output, 40)) expect(cells(row)).toBeLessThanOrEqual(40)
  })
})

describe('which of a venue’s accounts a row is about', () => {
  /** Two wallets, one of them one price move from being called in. */
  const twoWallets = () =>
    map(
      holding('aave', [
        at('aave', 'collateral', 'ETH', '10', {
          liquidation: { healthFactor: d('1.05'), liquidationThreshold: d('0.83') },
        }),
        at('aave', 'debt', 'USDC', '-8000', { encumbers: ['aave:collateral:ETH'] }),
      ]),
    )

  test('what breaks first names the account to act on, not only the venue', async () => {
    // Two wallets both at aave rank as two rows spelled identically otherwise:
    // a distance with no account on it names neither of them.
    const session = await sessionOver(twoWallets(), ['aave'])
    const { output } = await commands.breaks(session)
    expect(output).toContain('ACCOUNT')
    expect(output).toContain('hot (0xabc)')
    expect(output).toContain('vault (0xdef)')
  })

  test('a venue holding one account gains no account column', async () => {
    const { output } = await commands.breaks(await sessionOver(twoWallets()))
    expect(output).not.toContain('ACCOUNT')
  })

  test('positions names it too, or two wallets are two identical rows', async () => {
    const { output } = await commands.positions(await sessionOver(twoWallets(), ['aave']))
    expect(output).toContain('ACCOUNT')
    expect(output).toContain('vault (0xdef)')
  })

  test('one wallet’s debt does not claim the other wallet’s collateral', async () => {
    // The ids are namespaced per account and `encumbers` moves with them, so
    // this holds without anything here reading meaning out of an id.
    const session = await sessionOver(twoWallets(), ['aave'])
    const { output } = await commands.positions(session)
    const pledged = output
      .split('\n')
      .filter((l) => l.startsWith('aave') && l.includes('securing a debt'))
    expect(pledged).toHaveLength(2)
    expect(pledged.map((l) => /\b(6|10)\s/.test(l))).toEqual([true, true])
  })
})

/** The `Never asked for` block alone, cut at the blank line that ends it. */
const disclosed = (output: string): string =>
  output.split('Never asked for')[1]?.split('\n\n')[0] ?? ''

describe('four states, and a reader never has to work out which', () => {
  const failing = (id: string): Connector => ({
    ...CONNECTORS.get(id)!,
    fetchPositions: async () => {
      throw new Error('the venue did not answer')
    },
  })

  test('a venue that answered about nothing is a failure and not a coverage gap', async () => {
    // Named in both it would be told that nothing failed, two rows under the
    // line saying it went down.
    const connectors = map(failing('binance'), holding('wallet', [at('wallet', 'spot', 'ETH', '1')]))
    const session = await sessionOver(connectors)
    expect((await commands.positions(session)).output).toContain('INCOMPLETE')
    // On `/venues`, which is where the disclosure lives now: a venue named in
    // both would be told that nothing failed, under the row saying it went down.
    // The block itself, not everything below it: `/venues` also prints the
    // roster of connectors this build ships, which names binance either way.
    const { output } = await commands.venues(session, connectors)
    expect(disclosed(output)).not.toContain('binance')
  })

  test('a venue that answered from one address and failed at another still discloses its gaps', async () => {
    // Dropped on the first failure, the wallet that did answer would go
    // undisclosed with it — and it is the one with holdings in it.
    const flaky: Connector = {
      ...CONNECTORS.get('wallet')!,
      fetchPositions: async (creds) => {
        if (creds['address'] === '0xdef') throw new Error('the node did not answer')
        return [at('wallet', 'spot', 'ETH', '1')]
      },
    }
    const connectors = map(flaky)
    const session = await sessionOver(connectors, ['wallet'])
    expect((await commands.positions(session)).output).toContain('INCOMPLETE')
    const { output } = await commands.venues(session, connectors)
    expect(output).toContain('Never asked for')
    expect(disclosed(output)).toContain('wallet')
  })

  test('an empty venue that tula only half reads says that is a third possibility', async () => {
    // The Aave V4 case: the account answered, holds nothing tula asked about,
    // and nothing failed. Without this it reads as an empty account.
    const session = await sessionOver(map(holding('aave', [])))
    const { output } = await commands.positionsAt(session, 'aave', 'lending')
    expect(output).toContain('nothing here reads')
    expect(output).not.toContain('replaces it')
  })

  test('the offer under an empty venue is what connecting now does', async () => {
    const session = await sessionOver(map(holding('aave', [])))
    const { output } = await commands.positionsAt(session, 'aave', 'lending')
    expect(output).toContain('adds another account, or replaces this one')
  })
})
