import type { RiskEngine, VenueStatus } from '../agent/engine.js'
import { CONNECTORS } from '../connectors/registry.js'
import { retired } from '../connectors/types.js'
import { availability } from '../core/availability.js'
import { availabilityFacts, disclosure } from '../core/coverage.js'
import { belongsToVenue } from '../core/position.js'
import { scenario, shockedHealthFactors, whatBreaksFirst, type Shock } from '../core/risk.js'
import { forgetCommand } from './registry.js'
import type { Session } from './session.js'

/**
 * The only bridge between the session and the agent layer. It hands over
 * computed views and nothing else — no connector, no credential, no fetch.
 */
export function riskEngineFor(session: Session): RiskEngine {
  return {
    positions: () => session.current.positions,
    exposures: () => session.exposures(),
    breaks: () => whatBreaksFirst(session.current.positions, session.current.prices),
    scenario: (shocks: Shock[]) => scenario(session.current.positions, session.current.prices, shocks),
    shockedHealthFactors: (shocks: Shock[]) =>
      shockedHealthFactors(session.current.positions, session.current.prices, shocks),

    // Both read the connector manifests rather than the map this session was
    // built with: what a venue declares it does not read is a fact about the
    // build, and a second source for it is how a sentence and its code drift.
    availability: () =>
      availability(
        session.current.positions,
        availabilityFacts(CONNECTORS, session.current.connected),
      ),
    coverage: () =>
      disclosure(
        CONNECTORS,
        session.current.connected,
        session.current.failures.map((f) => f.split(':')[0] ?? ''),
      ),

    venues: (): VenueStatus[] => {
      const { positions, failures, connected, stale } = session.current
      const kept = new Set(stale)
      const byVenue = new Map<string, { count: number; asOf: Date }>()
      const ids = session.venueIds
      for (const p of positions) {
        // Folded back to the venue the user connected, as `/venues` and the
        // status line both do. One Aave address across three of its markets is
        // one venue, and the model answering three while the screen says one is
        // the same book described two ways.
        const venue = ids.find((id) => belongsToVenue(p.venue, id)) ?? p.venue
        const seen = byVenue.get(venue)
        if (seen) {
          seen.count += 1
          if (p.asOf < seen.asOf) seen.asOf = p.asOf
        } else {
          byVenue.set(venue, { count: 1, asOf: p.asOf })
        }
      }

      // A row per venue that was asked, not per venue that answered with
      // something. Built from the positions alone, a connected venue holding
      // nothing produced no row at all — and `src/agent/tools.ts` reads an
      // empty list as a connection gap, so the model was told nothing was
      // connected about venues that are. `/venues` says `connected, holding
      // nothing` for the same state.
      const rows: VenueStatus[] = []
      const failureFor = (venue: string): string | undefined =>
        failures.find((f) => f.startsWith(`${venue}: `))
      for (const venue of connected) {
        const failure = failureFor(venue)
        const held = byVenue.get(venue)
        byVenue.delete(venue)
        // A venue that failed keeps the rows it last returned, and they are in
        // `get_positions` and in every total. Reporting it as `0` here would
        // hand the model two answers about one venue and no way to tell that
        // the rows it can see are the previous read.
        const text = failure ? failure.split(': ').slice(1).join(': ') : ''
        rows.push(
          failure
            ? {
                venue,
                positions: held?.count ?? 0,
                asOf: held?.asOf ?? null,
                status: kept.has(venue)
                  ? `failed: ${text} — the positions counted here are its previous read, not this one`
                  : `failed: ${text}`,
              }
            : { venue, positions: held?.count ?? 0, asOf: held?.asOf ?? null, status: 'ok' },
        )
      }
      // A label no connected venue claims still has to be reported rather than
      // dropped: an unnamed holding is one the model would never mention.
      for (const [venue, held] of byVenue) {
        rows.push({ venue, positions: held.count, asOf: held.asOf, status: 'ok' })
      }
      for (const failure of failures) {
        const [venue = '?', ...rest] = failure.split(': ')
        if (connected.includes(venue)) continue
        // Removed is not failed: nothing was asked of a venue this build
        // dropped, so naming it as a failure tells the model a venue went down.
        const gone = retired(venue, forgetCommand(venue))
        rows.push({
          venue,
          positions: 0,
          asOf: null,
          status: gone ? `removed: ${gone}` : `failed: ${rest.join(': ')}`,
        })
      }
      return rows
    },

    freshness: () => ({
      oldest: session.stalest(),
      loadedAt: session.current.loadedAt,
      failures: session.current.failures,
      priceError: session.current.priceError,
    }),
  }
}
