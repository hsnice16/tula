import { describe, expect, test } from 'bun:test'
import { buildPalette, matchPalette, type PriceEntry, type VenueEntry } from './registry.js'

const VENUES: VenueEntry[] = [
  { id: 'kraken', detail: '12 balances · 3s ago', connected: true },
  { id: 'aave', detail: 'Aave v3 — not connected', connected: false },
]
const PRICES: PriceEntry[] = [{ id: 'coingecko', detail: 'CoinGecko — pricing everything', active: true }]

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
