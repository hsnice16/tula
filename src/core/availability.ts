import Decimal from 'decimal.js'
import { belongsToVenue, type Position, type VenueId, type VenueKind } from './position.js'

/**
 * How much of a holding can actually be moved, and what is holding the rest.
 *
 * A separate function from `netExposure` rather than fields on `NetExposure`,
 * because they answer different questions: exposure is sensitivity to a price
 * move, and a pledged asset moves with its price exactly as an unpledged one
 * does. The two were conflated once already — `Net value` became `Net notional`
 * when "value" counted a leveraged perp's whole position — and a `free` field
 * inside a record about price sensitivity invites it back. Nothing here reaches
 * `delta`.
 *
 * It is also where the `encumbers` graph is inverted exactly once. `encumbers`
 * is set on the *debt* leg and points at the collateral, so a collateral
 * position does not know it is pledged: answering for it means scanning every
 * position for anyone pointing at it, and three call sites doing that
 * independently is three answers.
 */

const ONE = new Decimal(1)
const ZERO = new Decimal(0)

/**
 * What the venue behind a row says about its own balances. Assembled from the
 * connector manifests by `src/core/coverage.ts`, so a venue that stops being
 * able to prove a free figure says so in one declaration rather than here.
 */
export interface VenueFacts {
  /**
   * How the venue holds money. A payment processor's hold clears with time and
   * an exchange's clears when you cancel the order, and telling somebody to
   * wait for a hold they could release now is the dead end rule 7 forbids.
   */
  readonly kind: VenueKind
  /**
   * Why this venue cannot state a free balance, in the connector's own words,
   * or null where it can. A sentence rather than a flag: a figure tula refuses
   * to state is only useful beside the reason it refused.
   */
  readonly freeUnprovable: string | null
}

/** Why a quantity cannot move. The words a row prints. */
export type Reason =
  | 'securing a debt'
  | 'margining a perp'
  | 'pledged elsewhere'
  | 'on hold for an order'
  | 'not settled yet'
  | 'staked'

/**
 * What releases each reason. A reason with no next step tells a reader they
 * cannot act and not what to do, which is the one thing this split exists to
 * avoid — the whole point of not having a single "encumbered" bucket.
 *
 * The Aave sentence states the protocol's own limit and stops there. Withdrawing
 * to exactly 1.00 is the point at which the position is liquidated, and tula's
 * job is the true number plus what it means; inventing a safety buffer would be
 * tula deciding for the user. `breaks` already answers what happens if you do.
 */
export const RELEASES: Readonly<Record<Reason, string>> = {
  'securing a debt':
    'repay the debt. The lender releases collateral only down to health factor 1.00, which is the level it liquidates at.',
  'margining a perp': 'close or reduce the perp it is margining.',
  'pledged elsewhere': 'close the position it is pledged to.',
  'on hold for an order': 'cancel the order holding it.',
  'not settled yet': 'wait for it to settle. Nothing you do at the venue moves it sooner.',
  staked: 'unstake it, then wait out the unbonding period.',
}

export interface Claim {
  reason: Reason
  /** Positive. Never netted against another claim: they are separate holds. */
  quantity: Decimal
}

export interface Availability {
  position: Position
  /**
   * Null where the venue reports nothing that proves it — never the total.
   * Reporting a whole balance as free because the venue did not mention a hold
   * is the confident wrong answer `KeyScope`'s tri-state exists to refuse.
   *
   * Negative where a holding is claimed for more than it holds, which is what
   * a health factor under 1 describes. Clamped to zero it would read as a
   * position that is merely fully pledged.
   */
  free: Decimal | null
  claims: readonly Claim[]
  /** Why `free` is null, in words for the reader. Null when `free` is known. */
  unprovable: string | null
}

/**
 * A collateral leg whose debt is missing from the book. Not a licence to call
 * the holding free: the claim is real and only its size is unreadable.
 */
const DANGLING =
  'a position claiming collateral here could not be read, so what is left free here is unknown'

/** How far a gap reaches: one venue label, or one address inside it. */
const scope = (p: Position): string => (p.account ? `${p.account.id}@${p.venue}` : p.venue)

const sum = (claims: readonly Claim[]): Decimal =>
  claims.reduce((total, c) => total.plus(c.quantity), ZERO)

/** How much of this holding is spoken for. */
export const claimed = (a: Availability): Decimal => sum(a.claims)

/** A holding claimed beyond what it holds — already past its liquidation. */
export const overclaimed = (a: Availability): boolean =>
  a.free !== null && a.free.isNegative()

/**
 * Whether this row has anything to say. An asset that is entirely free gains no
 * column: the answer would cost more attention than it returns.
 */
export const constrained = (a: Availability): boolean => a.free === null || a.claims.length > 0

/** The venue's own hold, in the words that name the way out of it. */
function holdReason(kind: VenueKind | undefined): Reason {
  return kind === 'payments' ? 'not settled yet' : 'on hold for an order'
}

/** What the positions pointing at this one are, worst first. */
function reasonFor(holders: readonly Position[]): Reason {
  if (holders.some((h) => h.kind === 'debt')) return 'securing a debt'
  if (holders.some((h) => h.kind === 'perp')) return 'margining a perp'
  return 'pledged elsewhere'
}

/**
 * How much of a pledged leg the protocol will release, from the health factor
 * alone.
 *
 * A market is liquidatable below `HF = weighted collateral / debt = 1`, so
 * releasing the same fraction `f` of every collateral leg leaves `HF(1 - f)`,
 * and `f = 1 - 1/HF` is where that reaches 1. Prices and liquidation thresholds
 * cancel out of that ratio, which is what lets a quantity be split with no
 * price in hand — and with one collateral asset, the common case, it is exactly
 * what the protocol will let go of.
 *
 * Below 1 it is negative, and it stays negative: that is a holding already
 * claimed for more than it holds, and rounding it up to zero would report the
 * one state the reader most needs to see as an ordinary full pledge.
 */
function releasable(quantity: Decimal, healthFactor: Decimal): Decimal {
  return quantity.times(ONE.minus(ONE.div(healthFactor)))
}

/**
 * One entry per holding — a positive quantity somebody could try to move. Debts
 * and shorts are negative and are not holdings: there is nothing to free.
 *
 * `facts` is keyed by the venue the user connected, and matched with
 * `belongsToVenue` so a venue's own sub-account labels — `kraken-margin`,
 * `aave-prime` — are answered by the venue's declaration rather than falling
 * through it.
 */
export function availability(
  positions: readonly Position[],
  facts: ReadonlyMap<VenueId, VenueFacts> = new Map(),
): Availability[] {
  const byId = new Map(positions.map((p) => [p.id, p]))

  // The one inversion. Everything below reads this map instead of walking
  // `encumbers` again.
  const holdersOf = new Map<string, Position[]>()
  const unreadable = new Set<string>()
  for (const p of positions) {
    for (const id of p.encumbers ?? []) {
      if (!byId.has(id)) {
        // As narrow as the book allows: by the venue's own label rather than
        // the venue the user connected, and by the address inside it where a
        // venue watches several — one market that lost a leg says nothing
        // about the market beside it, and one wallet says nothing about the
        // next. Not by parsing an id: the account is a field.
        unreadable.add(scope(p))
        continue
      }
      const holders = holdersOf.get(id)
      if (holders) holders.push(p)
      else holdersOf.set(id, [p])
    }
  }

  const factsFor = (label: VenueId): VenueFacts | undefined => {
    for (const [venueId, entry] of facts) if (belongsToVenue(label, venueId)) return entry
    return undefined
  }

  const out: Availability[] = []
  for (const position of positions) {
    // A derivative is exposure, not a balance: there is no quantity of it to
    // move, and answering "1.5 free" about a long perp would offer it as cash.
    // A debt and a short are negative and are not holdings either.
    if (position.kind === 'perp' || position.quantity.lte(0)) continue
    const venue = factsFor(position.venue)

    if (unreadable.has(scope(position))) {
      out.push({ position, free: null, claims: [], unprovable: DANGLING })
      continue
    }

    // Kinds the model already defines as money that is yours and not yours to
    // move. The whole row is the claim; there is no split left to prove.
    if (position.kind === 'pending' || position.kind === 'staked') {
      const reason = position.kind === 'staked' ? 'staked' : holdReason(venue?.kind)
      out.push({
        position,
        free: ZERO,
        claims: [{ reason, quantity: position.quantity }],
        unprovable: null,
      })
      continue
    }

    const holders = holdersOf.get(position.id) ?? []
    if (holders.length > 0) {
      // One claim, not one per holder: a health factor already covers every
      // debt in the market, and a claim per debt would subtract the same
      // collateral twice.
      //
      // With no health factor there is nothing to size the claim with: Kraken
      // publishes a margin level for the account rather than the position, and
      // Hyperliquid's per-position margin is discarded. The whole row is
      // claimed there — it is an asset bought on margin or a shared margin
      // pool, and offering part of it as cash is the answer that costs money.
      const factor = position.liquidation?.healthFactor
      const free =
        factor && factor.isFinite() && factor.gt(0)
          ? releasable(position.quantity, factor)
          : ZERO
      out.push({
        position,
        free,
        claims: [{ reason: reasonFor(holders), quantity: position.quantity.minus(free) }],
        unprovable: null,
      })
      continue
    }

    // Nothing in the book claims it, so the only question left is whether the
    // venue reported enough to prove the balance is free.
    if (venue?.freeUnprovable) {
      out.push({ position, free: null, claims: [], unprovable: venue.freeUnprovable })
      continue
    }

    out.push({ position, free: position.quantity, claims: [], unprovable: null })
  }

  return out
}

/** Keyed for a renderer walking rows it already has. */
export function availabilityById(
  positions: readonly Position[],
  facts: ReadonlyMap<VenueId, VenueFacts> = new Map(),
): Map<string, Availability> {
  return new Map(availability(positions, facts).map((a) => [a.position.id, a]))
}
