import Decimal from 'decimal.js'
import { claimed, RELEASES } from '../core/availability.js'
import { freshness, healthFactor, marginRatio, pct, price, quantity, ratioFloor, ratioValue, usd } from '../core/format.js'
import { unrankedVenues } from '../core/coverage.js'
import { belongsToVenue, type Position } from '../core/position.js'
import type { Shock } from '../core/risk.js'
import { seal, untrusted, type Untrusted } from '../core/untrusted.js'
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
    description:
      'Individual positions, un-netted, as each venue reports them, with how much of each holding is free to move and what is holding the rest. free_to_move is the answer to "can I actually spend this"; the quantity beside it is exposure and moves with the price whether it can be moved or not. held_as is the venue’s own name for an asset counted as another (WETH counted as ETH), and product is the contract, margin book, vault or staking state a row is held in: name them whenever two rows share a venue, kind and asset.',
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
      'Every position that can be liquidated, ordered nearest first. move_to_liquidation is a signed move in the current price: -35.0% means a 35% fall triggers it, +22.0% a 22% rise. "liquidatable now" means it is already at or past its trigger and no move is needed. Null means the distance could not be computed: either the venue gave no liquidation data, or the mark had no price to measure the move from — a liquidation_price on the same row is the second case. Neither is the same as safe.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'run_scenario',
    description:
      'Reprice the whole book under one or more price shocks: the change in value, each shocked position’s health factor before and after, exactly which positions liquidate, and which ones could not be evaluated because the venue gave no liquidation data.',
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
      'Connected venues, how many positions each returned, how fresh the data is, any venue that failed, and never_asked_for — the parts of a connected venue tula does not read at all. A venue that answered is not the same as a venue that answered in full. Call this whenever the answer depends on the data being complete.',
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

/**
 * Every string in a result is one of two things, and the whole of this file's
 * job is that they never look alike: a figure `money`, `quantity` and the rest
 * rendered, or text a venue wrote. The second kind goes through `untrusted()`,
 * which types it so it cannot be assigned to a field declared as the first, and
 * `seal()` then publishes the paths it sits at. Nothing is wrapped — rule 6 has
 * the model quote these back verbatim, so the mark has to live beside the value
 * rather than around it.
 */
const marked = (text: string | null): Untrusted | null => (text === null ? null : untrusted(text))

export function executeTool(engine: RiskEngine, name: string, input: unknown): unknown {
  const args = (input ?? {}) as Record<string, unknown>
  const asset = typeof args['asset'] === 'string' ? args['asset'].toUpperCase() : undefined
  const venue = typeof args['venue'] === 'string' ? args['venue'] : undefined
  const now = new Date()
  const at = (d: Date): string => freshness(d, now)

  const status = engine.venues()
  const connected = status.map((v) => v.venue)
  /**
   * A row's own label folded back to the venue the user connected, the way
   * `get_venue_status` and the status line already report it, with the label
   * kept beside it rather than discarded. Raw, the model was told an asset sits
   * at `aave-prime` a turn after being told the only venue is `aave` — a venue
   * nobody connected, named to somebody deciding where to act.
   */
  const named = (label: string): { venue: Untrusted; sub_account?: Untrusted } => {
    const id = connected.find((v) => belongsToVenue(label, v)) ?? label
    return id === label
      ? { venue: untrusted(id) }
      : { venue: untrusted(id), sub_account: untrusted(label) }
  }

  /**
   * Which of a venue's accounts a row came from, where that venue holds more
   * than one. The venue says where to act and this says what to act on, and a
   * distance to liquidation carrying only the first names neither wallet.
   *
   * Not marked as outside text: the label is the name the user typed or the
   * address they pasted, and it is built by `credentialLabel` from neither a
   * secret nor anything a venue wrote.
   */
  const from = (p: Position): { account?: string } =>
    p.account ? { account: p.account.label } : {}

  /**
   * What tells two rows apart where venue, kind and asset do not: the venue's
   * own spelling of the asset, and the contract, book or vault it is held in.
   * Both are the venue's text.
   */
  const held = (p: Position): { held_as?: Untrusted; product?: Untrusted } => ({
    ...(p.heldAs ? { held_as: untrusted(p.heldAs) } : {}),
    ...(p.product ? { product: untrusted(p.product) } : {}),
  })

  // Every numeric answer carries whether the book behind it was complete.
  // The CLI has said this since the first release; the model was told only in
  // a system-prompt rule, with nothing in the data to act on — so a book
  // missing a venue was narrated as a total, exactly the defect the commands
  // were fixed for. `get_venue_status` still holds the detail; this is the
  // flag that makes the model go and read it.
  const f = engine.freshness()
  const incomplete =
    f.failures.length > 0 || f.priceError !== null
      ? {
          incomplete: {
            failed_venues: f.failures.map(untrusted),
            price_error: marked(f.priceError),
            warning:
              'Each line names what did not load at a venue and what that leaves out. A venue that still has rows in these results answered in part: every figure here is from what did load. Any other is missing from these totals, or is its previous read — get_venue_status says which. Say so before quoting any total, and that /refresh tries again.',
          },
        }
      : {}

  // Deliberately not on every result. What a connector never asks its venue for
  // does not resolve — a read-only tool has unbounded uncovered surface — so an
  // instruction to say it before every total is an instruction to open every
  // answer with the same caveat, which is how a reader learns to skip the
  // sentence that `incomplete` above needs them to read. `get_venue_status`
  // carries the whole of it, its description tells the model when to call it,
  // and the screen makes the same choice in `incompleteNote()`: the two surfaces
  // have to be short of the same things or one of them is lying.
  const uncovered = engine.coverage()

  // The exception, and only on the two results that rank a liquidation. Those
  // claim more than the rest — what can be called in, in order — so a venue in
  // the book with an unread area that could hold one of its own makes the order
  // wrong rather than short. `src/cli/commands.ts` puts the same sentence under
  // the same two tables: a caveat on one surface and not the other is one book
  // described two ways, which is what `src/consistency.test.ts` exists to stop.
  const unranked = unrankedVenues(uncovered, engine.positions())
  const unseen =
    unranked.length > 0
      ? {
          unranked_liquidation_sources: {
            venues: unranked,
            warning:
              'These venues are in this book and have an area tula does not read that could hold a liquidation of its own. Nothing failed. This ranking may therefore be short one, so say so rather than presenting the order as complete. get_venue_status names each area.',
          },
        }
      : {}

  switch (name) {
    case 'get_net_exposure': {
      const rows = engine
        .exposures()
        .filter((e) => asset === undefined || e.asset === asset)
        .map((e) => ({
          asset: untrusted(e.asset),
          net_quantity: quantity(e.delta),
          notional_usd: money(e.notional),
          venues: [...new Set(e.contributors.map((c) => named(c.venue).venue.untrusted))].map(
            untrusted,
          ),
          as_of: at(e.asOf),
        }))
      const value = engine.scenario([]).before
      return seal({
        exposures: rows,
        equity_usd: money(value.total),
        excluded_from_equity: {
          unpriced: value.unpriced.map(untrusted),
          no_equity_stated: value.unstated.map(untrusted),
        },
        note: 'Figures are final: quote them exactly as written. notional_usd null means no price was available, not zero value. equity_usd is what the book is worth — holdings at price, debt subtracted, each derivative at the equity its venue states — and is not the sum of notional_usd, which measures exposure. Anything in excluded_from_equity is missing from equity_usd; say so beside it.',
        ...incomplete,
      })
    }

    case 'get_positions': {
      // Rendered here rather than derived: `free_to_move` is on every holding,
      // not only the encumbered ones, because otherwise the free figure for an
      // unencumbered row is a subtraction — and arithmetic in this layer is the
      // one thing the boundary exists to stop.
      const free = new Map(engine.availability().map((a) => [a.position.id, a]))
      const rows = engine
        .positions()
        .filter(
          (p) =>
            (asset === undefined || p.asset === asset) &&
            (venue === undefined || belongsToVenue(p.venue, venue)),
        )
        .map((p) => {
          const a = free.get(p.id)
          return {
            ...named(p.venue),
            ...from(p),
            kind: p.kind,
            asset: untrusted(p.asset),
            ...held(p),
            quantity: quantity(p.quantity),
            // Absent on a debt or a short: it is not a holding, so there is
            // nothing about it to free.
            ...(a ? { free_to_move: a.free === null ? null : quantity(a.free) } : {}),
            ...(a && a.claims.length > 0
              ? {
                  unavailable: quantity(claimed(a)),
                  unavailable_because: a.claims.map((c) => ({
                    reason: c.reason,
                    quantity: quantity(c.quantity),
                    released_by: RELEASES[c.reason],
                  })),
                }
              : {}),
            ...(a?.unprovable ? { free_to_move_unknown_because: a.unprovable } : {}),
            as_of: at(p.asOf),
            ...(p.liquidation?.healthFactor
              ? { health_factor: healthFactor(p.liquidation.healthFactor) }
              : {}),
            ...(p.liquidation?.price ? { liquidation_price: price(p.liquidation.price) } : {}),
            ...(p.borrowing
              ? {
                  net_balance: quantity(p.quantity),
                  borrowed: quantity(p.borrowing.borrowed),
                  supplied: quantity(p.borrowing.supplied),
                  loan_to_value: marginRatio(p.borrowing.ltv),
                  borrow_cap_used: marginRatio(p.borrowing.capUsed),
                }
              : {}),
          }
        })
      return seal({
        positions: rows,
        note: 'Figures are final: quote them exactly as written. free_to_move null means the venue reports nothing that proves it, never that none of it is free; a negative one means the holding is claimed for more than it holds and is already liquidatable.',
        ...incomplete,
      })
    }

    case 'what_breaks_first': {
      const rows = engine.breaks().map((r) => ({
        ...named(r.position.venue),
        ...from(r.position),
        asset: untrusted(r.position.asset),
        ...held(r.position),
        kind: r.position.kind,
        move_to_liquidation:
          r.liquidatable ? 'liquidatable now' : r.move === null ? null : pct(r.move),
        ...(r.position.liquidation?.healthFactor
          ? { health_factor: healthFactor(r.position.liquidation.healthFactor) }
          : {}),
        ...(r.position.liquidation?.price
          ? { liquidation_price: price(r.position.liquidation.price) }
          : {}),
        ...(r.position.liquidation?.ratio
          ? {
              account_ratio: {
                name: r.position.liquidation.ratio.name,
                value: ratioValue(r.position.liquidation.ratio),
                ...(ratioFloor(r.position.liquidation.ratio) !== null
                  ? { covers_only_what_loaded: untrusted(ratioFloor(r.position.liquidation.ratio)!) }
                  : {}),
                liquidated_past: marginRatio(r.position.liquidation.ratio.threshold),
                ...(r.position.liquidation.ratio.borrowHealth !== undefined
                  ? {
                      borrow_health_factor: marginRatio(r.position.liquidation.ratio.borrowHealth),
                      borrow_health_factor_means: 'below 100% the account cannot borrow more; it is not a liquidation trigger',
                    }
                  : {}),
              },
              liquidated_with_this_account: (r.members ?? []).map((p) => ({
                kind: p.kind,
                asset: untrusted(p.asset),
                ...held(p),
                ...(p.liquidation?.price ? { liquidation_price: price(p.liquidation.price) } : {}),
              })),
            }
          : {}),
        as_of: at(r.position.asOf),
      }))
      return seal({
        risks: rows,
        note: 'Figures are final: quote them exactly as written. move_to_liquidation null means the distance could not be computed: the venue gave no liquidation data, or the mark had no price to measure from, which a liquidation_price on the same row tells apart. Neither is the same as safe. A row with account_ratio is an account the venue liquidates as a whole once that ratio passes liquidated_past; the positions in liquidated_with_this_account go with it, and their own liquidation_price lies past that trigger, so never rank them by it.',
        ...incomplete,
        ...unseen,
      })
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
        return seal({ error: 'No valid shocks. Each needs an asset and a signed percent.' })
      }

      const result = engine.scenario(shocks)
      const moveOn = (a: string): Decimal | undefined => shocks.find((s) => s.asset === a)?.pct
      const row = (p: Position) => ({
        ...named(p.venue),
        ...from(p),
        kind: p.kind,
        asset: untrusted(p.asset),
        ...held(p),
      })

      // The description promised these and the payload carried none, so the
      // model was told to expect a figure it then could not find — one step
      // from working it out, in the one layer that may never compute a number.
      // One row per market, because that is what a health factor covers, and
      // null after an unpriced leg for the reason a null notional is null.
      // `debt_this_shock_moves` is the assumption behind the figure beside it,
      // checked against the book: the factor holds the debt at today's value,
      // which is a stablecoin borrow and not a same-asset one. Stated here for
      // the same reason `/shock` prints it — the reader acting on the number is
      // the one who has to know which of the two they are looking at.
      const healthFactors = engine.shockedHealthFactors(shocks).map((r) => ({
        ...named(r.venue),
        ...(r.account ? { account: r.account.label } : {}),
        health_factor_before: healthFactor(r.before),
        health_factor_after: r.after === null ? null : healthFactor(r.after),
        debt_this_shock_moves: r.debt === null ? null : r.debt.assets.map(untrusted),
        real_health_factor_after: r.debt === null ? null : r.debt.real,
      }))

      // `liquidated` is derived from a liquidation distance, so a position the
      // venue gave no liquidation data for is absent from it — and absent from
      // `unpriced_and_excluded` too, which is a different set: assets missing
      // from the total. Under a note reading "Figures are final", that silence
      // answered "nothing would be liquidated" about a position nobody could
      // evaluate. Spot and pending are left out because they cannot be called
      // at all, which is the same test `holdings()` reads leverage by.
      const distances = new Map(engine.breaks().map((r) => [r.position.id, r.move]))
      const unevaluated = engine
        .positions()
        .filter(
          (p) =>
            p.kind !== 'spot' &&
            p.kind !== 'pending' &&
            // Evaluated through its account's ratio, in `account_ratios`.
            p.liquidation?.liquidatedWith === undefined &&
            moveOn(p.asset) !== undefined &&
            (distances.get(p.id) ?? null) === null,
        )
        .map(row)

      return seal({
        shocks: shocks.map((s) => ({ asset: untrusted(s.asset), move: pct(s.pct, 0) })),
        value_before_usd: usd(result.before.total),
        value_after_usd: usd(result.after.total),
        change_usd: usd(result.change),
        unpriced_and_excluded: result.before.unpriced.map(untrusted),
        no_equity_stated_and_excluded: result.before.unstated.map(untrusted),
        health_factors: healthFactors,
        account_ratios: result.ratios.map((r) => ({
          ...named(r.position.venue),
          ...from(r.position),
          name: r.ratio.name,
          before: ratioValue(r.ratio),
          after: r.after === null ? null : marginRatio(r.after),
          liquidated_past: marginRatio(r.ratio.threshold),
          ...(r.why === null ? {} : { not_recomputed_because: r.why }),
          ...(r.tiered ? { held_still: 'each position’s margin rate; a move into another margin tier changes it' } : {}),
        })),
        liquidated: result.liquidated.map(row),
        could_not_be_evaluated: unevaluated,
        note: 'Figures are final: quote them exactly as written. could_not_be_evaluated lists positions this shock could have called and the venue gave no liquidation data for; they are missing from liquidated, and that is a gap, not safety. An account_ratios entry with after null is the same gap for a whole account: its ratio could not be recomputed under this shock, so whether that account and every position in it liquidates is unknown — name it with its not_recomputed_because, and never say nothing liquidates without it. health_factor_after null means a leg of that market had no price, so the new factor is unknown rather than unchanged. health_factor_after holds the debt at today’s value: where debt_this_shock_moves is not null, that market borrows an asset this shock moves, the figure reprices the collateral side only, and real_health_factor_after says where the true one sits — say so rather than quoting the number alone.',
        ...incomplete,
        ...unseen,
      })
    }

    case 'get_venue_status': {
      // `status` is `ok` or the venue's own words about why it failed, so it is
      // outside text on the row that says whether to trust the rest.
      const venues = status.map((v) => ({
        venue: untrusted(v.venue),
        positions: v.positions,
        as_of: v.asOf === null ? null : at(v.asOf),
        status: untrusted(v.status),
      }))
      return seal({
        venues,
        oldest_data: f.oldest === null ? null : at(f.oldest),
        fetched_at: f.loadedAt === null ? null : at(f.loadedAt),
        failed_venues: f.failures.map(untrusted),
        price_error: marked(f.priceError),
        // The whole of what no other result carries. Three different
        // ways a book can be short meet here — a venue that failed, a venue
        // this build dropped, and this one, a venue that answered about part of
        // the account — and they must never be narrated as each other.
        never_asked_for: uncovered.areas.map((a) => ({
          venue: a.venue,
          area: a.what,
          why: a.why,
          hides: a.hides,
        })),
        // An empty list is the one venue answer that needs a next step: it is a
        // connection gap, and the user cannot act on it without being told how.
        ...(venues.length === 0
          ? { note: 'No venue is connected, so there is nothing to read. Say so, and that / opens the menu to connect one.' }
          : {}),
      })
    }

    default:
      return seal({ error: `Unknown tool: ${name}` })
  }
}
