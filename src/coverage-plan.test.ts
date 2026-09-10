import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { CONNECTORS } from './connectors/registry.js'

/**
 * Every gap a connector declares has somewhere to go.
 *
 * Declaring one costs an object in a manifest and, until this file existed,
 * created no obligation at all. So they accumulated the way anything free
 * does: thirty declared across seven connectors, thirteen of them in no plan
 * anywhere, and two — Coinbase's CFTC-regulated futures and Kraken's drawn
 * credit lines — mentioned in no file in the repository. Both hide something
 * a reader has money in. `ROADMAP.md` had a paragraph promising the opposite,
 * which is the shape this defect takes every time: prose about the tree,
 * drifting in the same silence as the thing it describes.
 *
 * The declaration and the plan are now one edit. What this cannot check is
 * whether the plan is any good; what it removes is the gap nobody had to put
 * anything behind, which is the failure that actually happened.
 */

const GAPS = [...CONNECTORS.values()].flatMap((c) =>
  (c.coverage?.doesNotRead ?? []).map((gap) => ({ venue: c.venue.id, ...gap })),
)

/** The `**Status**:` word of a task file, which is what says it can still take work. */
const statusOf = (path: string): string => {
  const line = /^\*\*Status\*\*:\s*(.+)$/m.exec(readFileSync(path, 'utf8'))
  return (line?.[1]?.trim().split(/[\s·,]/)[0] ?? '').toLowerCase()
}

const ROADMAP = readFileSync('ROADMAP.md', 'utf8')

describe('a declared gap names the task that would close it', () => {
  test('there are gaps to sweep, so nothing below passes over an empty list', () => {
    // Without this the whole file reports clean on the day somebody deletes
    // the manifests, which is the one way a sweep lies.
    expect(GAPS.length).toBeGreaterThan(20)
  })

  for (const gap of GAPS) {
    test(`${gap.venue}: "${gap.what.slice(0, 48)}…" points at a task that exists`, () => {
      expect({ plan: gap.plan, exists: existsSync(gap.plan) }).toEqual({
        plan: gap.plan,
        exists: true,
      })
    })

    test(`${gap.venue}: "${gap.what.slice(0, 48)}…" points at a task that can still take work`, () => {
      // A `done` task is a record of what happened, per `tasks/README.md`. An
      // open gap pointed at one reads as planned and is filed under finished —
      // which is worse than pointing nowhere, because it looks answered.
      expect({ plan: gap.plan, status: statusOf(gap.plan) }).not.toEqual({
        plan: gap.plan,
        status: 'done',
      })
    })
  }

  test('ROADMAP.md accounts for every task a gap points at', () => {
    // The table under "What is not read yet" is the reader's index into this,
    // and it was written by hand and wrong about thirteen gaps on the day it
    // shipped. Derived from the manifests it cannot be wrong again in that
    // direction: a new plan path fails here until the roadmap names it.
    const missing = [...new Set(GAPS.map((g) => g.plan))].filter((plan) => !ROADMAP.includes(plan))
    expect(missing).toEqual([])
  })

  test('every venue with a manifest declares its gaps, or declares it has none', () => {
    // `coverage` is optional on a connector, and an absent one is indistinguishable
    // from a complete one at every surface that reads it — so a venue added without
    // the block would be published as fully read rather than as unexamined.
    for (const connector of CONNECTORS.values()) {
      expect({ venue: connector.venue.id, declared: connector.coverage !== undefined }).toEqual({
        venue: connector.venue.id,
        declared: true,
      })
    }
  })
})

describe('what hides a liquidation is hand-built, never left to the aggregator', () => {
  /**
   * `ROADMAP.md` splits the tail on one question: everything uncovered that can
   * be *called in* is hand-built, and what only moves a total is the
   * aggregator's. A liquidation-hiding gap filed under the aggregator is that
   * rule quietly broken — which is how Kraken's account margin level came to
   * point at `01-aggregator-api.md`, a file that never mentions Kraken.
   */
  const AGGREGATOR = 'tasks/breadth/01-aggregator-api.md'

  for (const gap of GAPS.filter((g) => g.hides === 'liquidation')) {
    test(`${gap.venue}: "${gap.what.slice(0, 48)}…" is not filed under the aggregator`, () => {
      expect({ what: gap.what, plan: gap.plan }).not.toEqual({ what: gap.what, plan: AGGREGATOR })
    })
  }
})
