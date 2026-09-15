import { describe, expect, test } from 'bun:test'
import {
  argumentList,
  buildPalette,
  matchPalette,
  SLASH_COMMANDS,
  VENUE_SUBCOMMANDS,
  type CandidateContext,
  type PriceEntry,
  type VenueEntry,
} from './registry.js'

describe('argument candidates', () => {
  const context = (over: Partial<CandidateContext> = {}): CandidateContext => ({
    venues: VENUES,
    stored: [
      { name: 'kraken', summary: '12 balances · 3s ago' },
      { name: 'circle', summary: 'no longer read by this build' },
    ],
    assets: [
      { name: 'BTC', summary: 'held at kraken' },
      { name: 'ETH', summary: 'held at kraken' },
    ],
    accounts: () => [
      { name: 'hot', summary: 'hot (0xaaa)' },
      { name: 'cold', summary: 'cold (0xbbb)' },
    ],
    ...over,
  })
  const names = (line: string, over: Partial<CandidateContext> = {}) =>
    argumentList(line, context(over))?.candidates.map((c) => c.name)

  // A declaration nobody reads is a list that silently offers nothing.
  test('every argument the registry names says where its candidates come from', () => {
    for (const command of SLASH_COMMANDS.filter((c) => c.args)) {
      expect({ command: command.name, declared: command.arguments?.length }).toEqual({
        command: command.name,
        declared: command.args?.split(' ').length,
      })
    }
  })

  test('each position offers what the command takes there, filtered as typed', () => {
    expect(names('/connect ')).toEqual(['kraken', 'aave'])
    expect(names('/connect KR')).toEqual(['kraken'])
    expect(names('/update ')).toEqual(['install'])
    expect(names('/history c')).toEqual(['clear'])
    expect(names('/shock ')).toEqual(['BTC', 'ETH'])
    expect(names('/shock e')).toEqual(['ETH'])
  })

  // /forget is how a key for a venue this build dropped is removed, so the
  // venue that is no longer a venue is exactly the one it has to offer.
  test('forget offers what is stored, including a venue the build no longer reads', () => {
    expect(names('/forget ')).toEqual(['kraken', 'circle'])
  })

  test('shock comes round again after its percentage, which offers a shape, not a list', () => {
    const percent = argumentList('/shock ETH ', context())
    expect(percent?.candidates).toEqual([])
    expect(percent?.empty).toContain('percent')
    expect(percent?.heading).toBe('/shock <percent>')
    expect(names('/shock ETH -20 ')).toEqual(['BTC', 'ETH'])
  })

  test('an asset list before anything is read says what reads it, and reads nothing', () => {
    expect(argumentList('/shock ', context({ assets: null }))?.empty).toContain('/refresh')
    expect(argumentList('/shock ', context({ assets: null, stored: [] }))?.empty).toContain(
      'pick a venue',
    )
  })

  test('a venue holding several accounts offers them to disconnect, and one holding one does not', () => {
    expect(names('/kraken disconnect ')).toEqual(['hot', 'cold'])
    expect(
      argumentList('/kraken disconnect ', context({ accounts: () => [{ name: 'only', summary: 'only' }] })),
    ).toBeNull()
    expect(VENUE_SUBCOMMANDS.find((s) => s.name === 'disconnect')?.arguments).toBeDefined()
  })

  test('no list where there is nothing to complete', () => {
    expect(argumentList('/shock', context())).toBeNull()
    expect(argumentList('/exposure ', context())).toBeNull()
    expect(argumentList('/connect kraken extra ', context())).toBeNull()
    expect(argumentList('/connect zz', context())).toBeNull()
    expect(argumentList('what is my eth ', context())).toBeNull()
  })
})

const VENUES: VenueEntry[] = [
  { id: 'kraken', detail: '12 balances · 3s ago', connected: true },
  { id: 'aave', detail: 'Aave v3 — not connected', connected: false },
]
const PRICES: PriceEntry[] = [
  { id: 'coingecko', detail: 'CoinGecko — pricing everything', active: true, keyless: true },
  { id: 'coinmarketcap', detail: 'Widest coverage; a free API key is enough', active: false, keyless: false },
]

const paths = (query: string) =>
  matchPalette(query, buildPalette(VENUES, PRICES)).map((e) => e.path)

describe('buildPalette', () => {
  test('flattens venue subcommands the / menu only reaches in two steps', () => {
    expect(paths('')).toContain('kraken positions')
  })

  test('offers a disconnected venue only what it can actually do', () => {
    expect(paths('')).toContain('aave connect')
    expect(paths('')).not.toContain('aave positions')
  })

  test('marks anything with arguments left to supply as not runnable', () => {
    const shock = buildPalette(VENUES, PRICES).find((e) => e.path === 'shock')
    expect(shock?.runnable).toBe(false)
    expect(buildPalette(VENUES, PRICES).find((e) => e.path === 'exposure')?.runnable).toBe(true)
  })

  test('a keyless source is not offered a key to paste or forget', () => {
    expect(paths('')).not.toContain('coingecko connect')
    expect(paths('')).not.toContain('coingecko disconnect')
    expect(paths('')).toContain('coinmarketcap connect')
  })

  /**
   * The palette opens a heading wherever the group changes, so a group reached
   * in two runs was drawn as two identical headings — once for the venues and
   * again, further down, for everything reachable under them.
   */
  test('every section is one contiguous run', () => {
    const groups = buildPalette(VENUES, PRICES).map((e) => e.group)
    const runs = groups.filter((g, at) => g !== groups[at - 1])
    expect(runs).toEqual([...new Set(runs)])
  })

  test('a hidden command stays hidden until something is typed', () => {
    expect(paths('')).not.toContain('forget')
    expect(paths('forget')).toContain('forget')
  })
})

describe('matchPalette', () => {
  test('matches across the space, so the verb finds the venue', () => {
    expect(paths('krapos')[0]).toBe('kraken positions')
  })

  test('a name hit outranks every description hit', () => {
    // "positions" appears in the summary of /kraken positions and of /breaks.
    expect(paths('positions')[0]).toBe('positions')
  })

  test('finds a command by its description when the name gives nothing away', () => {
    expect(paths('liquidated')).toContain('breaks')
  })

  test('a leading slash is what the user typed, not part of the query', () => {
    expect(paths('/exposure')).toEqual(paths('exposure'))
  })

  test('returns nothing rather than everything when nothing matches', () => {
    expect(paths('zzzz')).toEqual([])
  })
})
