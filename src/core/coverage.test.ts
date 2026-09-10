import { describe, expect, test } from 'bun:test'
import { CONNECTORS } from '../connectors/registry.js'
import { areaLines, availabilityFacts, disclosure, notReadDetail } from './coverage.js'
import { cells, wrapLines } from '../ui/wrap.js'
import type { VenueManifest } from './coverage.js'

/** The registry itself, which is what the shipped line is built from. */
const build: ReadonlyMap<string, VenueManifest> = CONNECTORS

const half: VenueManifest = {
  venue: { id: 'half', kind: 'cex', name: 'Half' },
  coverage: {
    reads: ['spot balances'],
    doesNotRead: [{ what: 'the futures book', why: 'the endpoint is never called', hides: 'value' }],
  },
}

const whole: VenueManifest = {
  venue: { id: 'whole', kind: 'wallet', name: 'Whole' },
  coverage: { reads: ['everything'], doesNotRead: [] },
}

const made = new Map<string, VenueManifest>([
  ['half', half],
  ['whole', whole],
])

/**
 * `/venues` is where the whole of this is read: it is no longer printed beside
 * every figure, because coverage does not resolve the way a failure does and a
 * count that never reaches zero teaches the reader to skip the block. The
 * properties below are the same ones, checked on the surface that kept them.
 */
const line = (venues: string[], manifests: ReadonlyMap<string, VenueManifest> = made): string =>
  notReadDetail(disclosure(manifests, venues)).join('\n')

describe('what the book does not cover', () => {
  test('a connected venue read in part is named, since nothing else marks it', () => {
    // The defect: a venue that answered is taken as complete, so a half-read
    // account produces no failure and the total is understated in silence.
    expect(line(['half'])).toContain('half')
    expect(line(['half'])).toContain('Never asked for')
  })

  test('a venue with nothing left unread produces no line at all', () => {
    expect(line(['whole'])).toBe('')
  })

  test('a venue the user did not connect is not named — that is a decision, not a gap', () => {
    // Naming a venue somebody chose not to connect, every time they look, is
    // nagging dressed as honesty.
    expect(line(['whole'])).toBe('')
    expect(line([])).toBe('')
  })

  test('a venue with no connector in this build is never named', () => {
    // Unbounded, identical for every reader and actionable by none of them, so
    // it becomes wallpaper — and takes the parts that are about this account
    // down with it.
    expect(line(['a-venue-with-no-connector'])).toBe('')
  })

  test('a connected venue holding nothing is covered, not uncovered', () => {
    // An empty book and an unread one are the two states this line keeps apart,
    // and the line is built from declarations rather than from row counts.
    expect(line(['whole'])).toBe('')
  })

  test('it shrinks as coverage grows and goes when the last gap closes', () => {
    const closed: VenueManifest = { ...half, coverage: { reads: ['spot balances', 'the futures book'], doesNotRead: [] } }
    expect(line(['half'], new Map([['half', closed]]))).toBe('')
  })

  test('the wording does not move while the coverage has not', () => {
    // A line that changes between refreshes is noise the reader learns to skip.
    expect(line(['half', 'whole'])).toBe(line(['whole', 'half']))
    expect(line(['half'])).toBe(line(['half']))
  })

  test('it is worded and caused differently from INCOMPLETE and REMOVED', () => {
    // Three ways a book can be short: a venue failed, a venue was dropped from
    // the build, and a venue was never asked. A reader must not have to work
    // out which one they are looking at.
    const text = line(['half'])
    expect(text).not.toContain('INCOMPLETE')
    expect(text).not.toContain('REMOVED')
    expect(text).not.toContain('FAILED')
    expect(text).toContain('Never asked for')
    // The claim, not the absence of the word: read as a failure this block
    // would send somebody to retry a venue that answered.
    expect(text).toContain('nothing failed')
  })

  test('it fits the narrowest width the shell supports, wrapped rather than cut', () => {
    for (const width of [40, 60, 80]) {
      for (const row of wrapLines(line([...CONNECTORS.keys()], build), width)) {
        expect(cells(row)).toBeLessThanOrEqual(width)
      }
    }
  })

  test('a venue that failed is a failure, never a venue that answered in part', () => {
    // Named in both, a venue that went down would be told it answered about
    // the rest, two rows under the line saying it answered about nothing.
    expect(notReadDetail(disclosure(made, ['half'], ['half']))).toEqual([])
  })
})

describe('derived from what is registered, never written by hand', () => {
  test('a venue added to the registry changes the line with no prose edited', () => {
    const before = line(['half'])
    const added = new Map(made).set('extra', {
      venue: { id: 'extra', kind: 'cex', name: 'Extra' },
      coverage: { reads: [], doesNotRead: [{ what: 'the margin book', why: 'never called', hides: 'liquidation' }] },
    })
    const after = line(['half', 'extra'], added)
    expect(after).not.toBe(before)
    expect(after).toContain('extra')
    expect(after).toContain('the margin book')
  })

  test('every gap a shipped connector declares reaches the detail', () => {
    const declared = [...CONNECTORS.values()].flatMap((c) => c.coverage?.doesNotRead ?? [])
    const detail = notReadDetail(disclosure(build, [...CONNECTORS.keys()])).join('\n')
    for (const gap of declared) expect(detail).toContain(gap.what)
  })

  test('the Aave V4 migration that reads as an empty book is what the line names', () => {
    // The concrete case: V4 is declared unread, an account that moved there
    // answers with nothing, and no venue failed. Without this the reader is
    // shown an empty Aave book and no reason to doubt it.
    const detail = notReadDetail(disclosure(build, ['aave'])).join('\n')
    expect(detail).toContain('Aave V4')
    expect(line(['aave'], build)).toContain('aave')
  })

  test('every area says what it costs the reader, not what endpoint went unread', () => {
    const { areas } = disclosure(build, [...CONNECTORS.keys()])
    for (const rendered of areaLines(areas)) {
      expect(rendered).toMatch(/^(may hold value|may hide a liquidation|hides what you can move)\s{2,}/)
    }
  })
})

describe('what a connector declares about its own balances', () => {
  test('a declared availability gap is what makes a free figure unprovable', () => {
    // Written by hand this would be a second list to keep in step with the
    // first. Read off the declaration, closing the gap in the connector closes
    // it here in the same change — and the connector's own test holds it open.
    const facts = availabilityFacts(build, ['kraken', 'wallet'])
    expect(facts.get('kraken')?.freeUnprovable).toContain('Kraken does not read')
    expect(facts.get('wallet')?.freeUnprovable).toBeNull()
  })

  test('Stripe states what is available, so no Stripe row renders FREE as unknown', () => {
    // The one gap it declared was `instant_available` — a slice of `available`
    // skipped so the same money is not counted twice, filed as an availability
    // gap. That turned every Stripe spot row into `FREE —` under a legend
    // saying the free figure could not be proven, about a figure Stripe states
    // outright.
    expect(availabilityFacts(build, ['stripe']).get('stripe')?.freeUnprovable).toBeNull()
  })

  test('a venue nobody connected contributes no facts to read', () => {
    expect(availabilityFacts(build, []).size).toBe(0)
  })

  test('the venue kind travels with it, so a hold is described in its own terms', () => {
    expect(availabilityFacts(build, ['stripe']).get('stripe')?.kind).toBe('payments')
  })
})
