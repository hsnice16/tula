import type { RiskEngine, VenueStatus } from '../agent/engine.js'
import { belongsToVenue } from '../core/position.js'
import { scenario, whatBreaksFirst, type Shock } from '../core/risk.js'
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

    venues: (): VenueStatus[] => {
      const { positions, failures } = session.current
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
      const rows: VenueStatus[] = [...byVenue].map(([venue, v]) => ({
        venue,
        positions: v.count,
        asOf: v.asOf,
        status: 'ok',
      }))
      for (const failure of failures) {
        const [venue = '?', ...rest] = failure.split(': ')
        rows.push({ venue, positions: 0, asOf: null, status: `failed: ${rest.join(': ')}` })
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
