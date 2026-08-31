import Decimal from 'decimal.js'
import { freshness, pct, quantity, usd } from '../core/format.js'
import type { Shock } from '../core/risk.js'
import type { RiskEngine } from './engine.js'

export interface ToolDefinition {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_net_exposure',
    description:
      'Net exposure per asset across every connected venue, with notional value and which venues contributed. This is the netted figure: spot, perp and collateral legs of the same asset are already summed.',
    input_schema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'Optional symbol filter, e.g. ETH.' },
      },
    },
  },
  {
    name: 'get_positions',
    description: 'Individual positions, un-netted, as each venue reports them.',
    input_schema: {
      type: 'object',
      properties: {
        venue: { type: 'string', description: 'Optional venue filter.' },
        asset: { type: 'string', description: 'Optional symbol filter.' },
      },
    },
  },
  {
    name: 'what_breaks_first',
    description:
      'Every position that can be liquidated, ordered nearest first. move_to_liquidation is a signed move in the current price: -35.0% means a 35% fall triggers it, +22.0% a 22% rise. Null means the venue gave no liquidation data, which is not the same as safe.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'run_scenario',
    description:
      'Reprice the whole book under one or more price shocks and report the change in value, the new health factors, and exactly which positions liquidate.',
    input_schema: {
      type: 'object',
      properties: {
        shocks: {
          type: 'array',
          description: 'One entry per asset moved.',
          items: {
            type: 'object',
            properties: {
              asset: { type: 'string' },
              percent: { type: 'number', description: 'Signed percent, e.g. -20 for a 20% fall.' },
            },
            required: ['asset', 'percent'],
          },
        },
      },
      required: ['shocks'],
    },
  },
  {
    name: 'get_venue_status',
    description:
      'Connected venues, how many positions each returned, how fresh the data is, and any venue that failed. Call this whenever the answer depends on the data being complete.',
    input_schema: { type: 'object', properties: {} },
  },
]

/**
 * Every figure leaves here already rendered, by the same formatters the tables
 * use. Two reasons, and the second is the load-bearing one:
 *
 * 1. The model and `/exposure` can no longer disagree about the same holding.
 *    A raw `0.01136790246459898` invites the model to restate it in full, next
 *    to a table that says `0.0113679`, and a reader has to decide which is real.
 * 2. Rounding is arithmetic. Handing over a raw Decimal and asking for two
 *    places makes the model do the one thing it is forbidden to do; handing
 *    over the string makes the rule enforceable rather than merely stated.
 *
 * Null survives rendering — an unpriced asset stays null, never `$0.00`.
 */
const money = (value: Decimal | null): string | null => (value === null ? null : usd(value))

export function executeTool(engine: RiskEngine, name: string, input: unknown): unknown {
  const args = (input ?? {}) as Record<string, unknown>
  const asset = typeof args['asset'] === 'string' ? args['asset'].toUpperCase() : undefined
  const venue = typeof args['venue'] === 'string' ? args['venue'] : undefined
  const now = new Date()
  const at = (d: Date): string => freshness(d, now)

  switch (name) {
    case 'get_net_exposure': {
      const rows = engine
        .exposures()
        .filter((e) => asset === undefined || e.asset === asset)
        .map((e) => ({
          asset: e.asset,
          net_quantity: quantity(e.delta),
          notional_usd: money(e.notional),
          venues: [...new Set(e.contributors.map((c) => c.venue))],
          as_of: at(e.asOf),
        }))
      return {
        exposures: rows,
        note: 'Figures are final: quote them exactly as written. notional_usd null means no price was available, not zero value.',
      }
    }

    case 'get_positions': {
      const rows = engine
        .positions()
        .filter(
          (p) =>
            (asset === undefined || p.asset === asset) && (venue === undefined || p.venue === venue),
        )
        .map((p) => ({
          venue: p.venue,
          kind: p.kind,
          asset: p.asset,
          quantity: quantity(p.quantity),
          as_of: at(p.asOf),
          ...(p.liquidation?.healthFactor
            ? { health_factor: p.liquidation.healthFactor.toFixed(2) }
            : {}),
          ...(p.liquidation?.price ? { liquidation_price: usd(p.liquidation.price) } : {}),
        }))
      return { positions: rows, note: 'Figures are final: quote them exactly as written.' }
    }

    case 'what_breaks_first': {
      const rows = engine.breaks().map((r) => ({
        venue: r.position.venue,
        asset: r.position.asset,
        kind: r.position.kind,
        move_to_liquidation: r.move === null ? null : pct(r.move),
        ...(r.position.liquidation?.healthFactor
          ? { health_factor: r.position.liquidation.healthFactor.toFixed(2) }
          : {}),
        ...(r.position.liquidation?.price
          ? { liquidation_price: usd(r.position.liquidation.price) }
          : {}),
        as_of: at(r.position.asOf),
      }))
      return {
        risks: rows,
        note: 'Figures are final: quote them exactly as written. move_to_liquidation null means the venue gave no liquidation data, which is not the same as safe.',
      }
    }

    case 'run_scenario': {
      const raw = Array.isArray(args['shocks']) ? args['shocks'] : []
      const shocks: Shock[] = []
      for (const entry of raw) {
        const e = entry as Record<string, unknown>
        if (typeof e['asset'] !== 'string' || typeof e['percent'] !== 'number') continue
        shocks.push({ asset: e['asset'].toUpperCase(), pct: new Decimal(e['percent']).div(100) })
      }
      if (shocks.length === 0) {
        return { error: 'No valid shocks. Each needs an asset and a signed percent.' }
      }

      const result = engine.scenario(shocks)
      return {
        shocks: shocks.map((s) => ({ asset: s.asset, move: pct(s.pct, 0) })),
        value_before_usd: usd(result.before.total),
        value_after_usd: usd(result.after.total),
        change_usd: usd(result.change),
        unpriced_and_excluded: result.before.unpriced,
        liquidated: result.liquidated.map((p) => ({ venue: p.venue, kind: p.kind, asset: p.asset })),
        note: 'Figures are final: quote them exactly as written.',
      }
    }

    case 'get_venue_status': {
      const f = engine.freshness()
      const venues = engine.venues().map((v) => ({
        venue: v.venue,
        positions: v.positions,
        as_of: v.asOf === null ? null : at(v.asOf),
        status: v.status,
      }))
      return {
        venues,
        oldest_data: f.oldest === null ? null : at(f.oldest),
        fetched_at: at(f.loadedAt),
        failed_venues: f.failures,
        price_error: f.priceError,
        // An empty list is the one venue answer that needs a next step: it is a
        // connection gap, and the user cannot act on it without being told how.
        ...(venues.length === 0
          ? { note: 'No venue is connected, so there is nothing to read. Say so, and that / opens the menu to connect one.' }
          : {}),
      }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}
