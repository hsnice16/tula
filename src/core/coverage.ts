import type { VenueFacts } from './availability.js'
import { belongsToVenue, type Position, type VenueId, type VenueKind } from './position.js'

/**
 * What the connected venues were never asked for.
 *
 * Read on demand rather than printed beside every figure. A venue that answered
 * is otherwise taken as complete — somebody who migrated to Aave V4 sees an
 * empty Aave book, no `INCOMPLETE`, and no reason to doubt the total — but this
 * gap does not close the way a failure does, and a count on every view is a
 * number that never reaches zero. `src/cli/commands.ts` states where that
 * leaves it: `/venues`, a venue's own `status`, and the sentence under a venue
 * that answered holding nothing, which is the case it is actually about.
 *
 * Every word of it is read off the connector manifests. A sentence maintained
 * beside the code it describes is the defect `src/site-claims.test.ts` exists to
 * catch, and this one would go stale on the release that closed the gap.
 */

/** What a gap costs the reader. `availability` is the mildest. */
export type CoverageCost = 'value' | 'liquidation' | 'availability'

/**
 * A `Connector` as this file needs to read one. Declared structurally rather
 * than imported: `src/connectors/types.ts` sits below the canonical model, and
 * `scripts/guard.sh` fails the build the moment anything the agent layer reaches
 * imports a connector. A `Map<string, Connector>` satisfies it as it stands.
 */
export interface VenueManifest {
  readonly venue: { readonly id: string; readonly kind: VenueKind; readonly name: string }
  readonly coverage?: {
    readonly reads: readonly string[]
    readonly doesNotRead: readonly {
      readonly what: string
      readonly why: string
      readonly hides: CoverageCost
    }[]
  }
}

export interface UnreadArea {
  /** The venue the user connected, never a sub-account label. */
  venue: string
  what: string
  why: string
  hides: CoverageCost
}

export interface Disclosure {
  /** Connected venues that answer about part of the account only. Sorted. */
  venues: string[]
  /** In venue order, then in the order the connector declares them. */
  areas: UnreadArea[]
}

/**
 * A venue with no connector at all is deliberately absent. That list is
 * unbounded, identical for every reader and actionable by none of them, so it
 * becomes wallpaper — and a line read as wallpaper takes the parts that *are*
 * about this account down with it. `README.md` says which venues exist.
 *
 * A venue the user chose not to connect is absent for a different reason: that
 * is a decision, and naming it every time they look is nagging dressed as
 * honesty. Only what was connected and half-read is here.
 */
export function disclosure(
  manifests: ReadonlyMap<string, VenueManifest>,
  connected: readonly string[],
  /**
   * Venues that were asked and did not answer. Named as failures instead: a
   * venue in both lines would be told it answered in part and that nothing
   * failed, two rows under the one saying it went down.
   */
  failed: readonly string[] = [],
): Disclosure {
  const areas: UnreadArea[] = []
  // Sorted so the wording is stable between refreshes. A line that changes
  // while the coverage has not is noise the reader learns to skip.
  for (const venue of [...connected].filter((v) => !failed.includes(v)).sort()) {
    for (const gap of manifests.get(venue)?.coverage?.doesNotRead ?? []) {
      areas.push({ venue, what: gap.what, why: gap.why, hides: gap.hides })
    }
  }
  return { venues: [...new Set(areas.map((a) => a.venue))], areas }
}

/** English, not a comma-joined array: this is read as a sentence. */
export function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * Venues in this book with an unread area that could hold something
 * liquidatable.
 *
 * The one part of a disclosure that survives being asked for rather than
 * printed, because `breaks` and `shock` make a stronger claim than the views
 * that only state quantities: they say what can be called in, in order. A
 * source neither of them can see makes that order *wrong* rather than short,
 * and an order that is wrong is the failure this product exists to prevent —
 * where the same gap under `positions` is only a total smaller than the
 * account, which is what `/venues` is for.
 *
 * Narrowed twice on purpose. To `hides: 'liquidation'`, so it shortens as those
 * gaps close and goes silent with the last of them; and to venues that actually
 * returned rows, so it is a fact about this book rather than about the build —
 * a venue that answered holding nothing is `unreadVenue()`'s to say.
 */
export function unrankedVenues(d: Disclosure, positions: readonly Position[]): string[] {
  return d.venues.filter(
    (venue) =>
      positions.some((p) => belongsToVenue(p.venue, venue)) &&
      d.areas.some((a) => a.venue === venue && a.hides === 'liquidation'),
  )
}

/** What the gap costs, in the reader's terms rather than the manifest's. */
const COSTS: Readonly<Record<CoverageCost, string>> = {
  value: 'may hold value',
  liquidation: 'may hide a liquidation',
  availability: 'hides what you can move',
}

/**
 * One line per area, opening with what it costs the reader. The width is taken
 * from every label rather than only the ones present, so the column does not
 * move between two venues or between two refreshes.
 */
export function areaLines(areas: readonly UnreadArea[]): string[] {
  const width = Math.max(...Object.values(COSTS).map((c) => c.length))
  return areas.map((a) => `${COSTS[a.hides].padEnd(width)}  ${a.what}`)
}

/**
 * The areas themselves, grouped under the venue they belong to. Held back from
 * the line above because twenty of them with every view is the wallpaper that
 * line is written to avoid; this is where somebody who read it goes.
 */
export function notReadDetail(d: Disclosure): string[] {
  if (d.areas.length === 0) return []
  const lines = ['Never asked for. These venues answered about the rest, and nothing failed:']
  for (const venue of d.venues) {
    lines.push(`  ${venue}`)
    for (const line of areaLines(d.areas.filter((a) => a.venue === venue))) {
      lines.push(`    ${line}`)
    }
  }
  return lines
}

/**
 * What each connected venue says about its own balances, for
 * `src/core/availability.ts`.
 *
 * A connector that declares it cannot read a hold is a connector whose free
 * figure is unprovable, and the declaration and the code fail together: the
 * gap is held open by a test in the connector's own suite, so closing it there
 * closes it here in the same change. Written by hand it would be a second list
 * to keep in step with the first.
 */
export function availabilityFacts(
  manifests: ReadonlyMap<string, VenueManifest>,
  connected: readonly string[],
): Map<VenueId, VenueFacts> {
  const facts = new Map<VenueId, VenueFacts>()
  for (const venue of connected) {
    const manifest = manifests.get(venue)
    if (!manifest) continue
    const gap = manifest.coverage?.doesNotRead.find((g) => g.hides === 'availability')
    facts.set(venue, {
      kind: manifest.venue.kind,
      freeUnprovable: gap ? `${manifest.venue.name} does not read ${gap.what}: ${gap.why}` : null,
    })
  }
  return facts
}
