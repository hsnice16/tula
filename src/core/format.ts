import type Decimal from 'decimal.js'
import type { Position, VenueKind } from './position.js'

/**
 * Trailing zeros are stripped so a column of quantities is scanned by its
 * digits rather than by padding. Small balances keep more places: 8dp is the
 * satoshi/wei-adjacent floor, and a holding below it renders `<0.00000001`
 * rather than `0`. A row that exists must not read as a row that does not —
 * and dropping the row instead is the same wrong answer with nothing left on
 * screen to question.
 */
export function quantity(value: Decimal | null): string {
  // An em dash for null, for the reason `usd` uses one: a quantity nobody could
  // prove is not a zero holding, and `0` in a column of free balances reads as
  // "none of this can move" rather than "tula does not know".
  if (value === null || !value.isFinite()) return '—'
  const dp = value.abs().gte(1) ? 4 : 8
  const fixed = value.toFixed(dp)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  if (trimmed !== '0' && trimmed !== '-0') return trimmed
  // Read off the rendering rather than off a second copy of the floor: what
  // rounds away here is exactly what the marker is for. A true zero keeps its
  // `0` and loses its sign — `-0` is an artifact of the rounding, not a
  // direction anybody holds.
  if (value.isZero()) return '0'
  return `${value.isNegative() ? '-' : ''}<0.${'0'.repeat(dp - 1)}1`
}

/** Grouped over the integer part only: a price carries more than two decimals,
 *  and grouping the whole string punctuates those too. */
function grouped(fixed: string): string {
  const dot = fixed.indexOf('.')
  const whole = dot === -1 ? fixed : fixed.slice(0, dot)
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dot === -1 ? '' : fixed.slice(dot))
}

/**
 * Absolute time plus age. A bare clock hides that a venue stopped responding
 * an hour ago, and a bare age hides which snapshot you are looking at.
 *
 * Days are a separate unit rather than more hours: "72h ago" reads as a long
 * number, "3d ago" reads as an alarm, and that is the one it should read as.
 */
export function freshness(asOf: Date, now: Date = new Date()): string {
  // A venue or a price source can send a timestamp that does not parse, and
  // `Invalid  (NaNd ago)` in an AS OF column reads as a bug in tula rather than
  // as the one thing it is: we do not know how old this figure is.
  if (Number.isNaN(asOf.getTime()) || Number.isNaN(now.getTime())) return '—'
  const seconds = Math.max(0, Math.round((now.getTime() - asOf.getTime()) / 1000))
  const age =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.round(seconds / 60)}m`
        : seconds < 86400
          ? `${Math.round(seconds / 3600)}h`
          : `${Math.round(seconds / 86400)}d`
  return `${asOf.toTimeString().slice(0, 8)} (${age} ago)`
}

/**
 * An em dash for null, never `$0.00`: an unknown price is not a zero value. A
 * known one under a cent is `<$0.01` for the same reason — `$0.00` beside a
 * real, priced holding is indistinguishable from worthless.
 *
 * Not `price`'s four significant digits: a total is read to the cent and a
 * column of them is scanned down the decimal point, so the cents stay fixed and
 * the one figure that cannot be shown there says so instead of guessing at it.
 */
export function usd(value: Decimal | null): string {
  if (value === null || !value.isFinite()) return '—'
  const sign = value.isNegative() ? '-' : ''
  const fixed = value.abs().toFixed(2)
  // Read off the rendering rather than off a threshold of its own, so the
  // marker covers exactly what two places round away and nothing else.
  if (fixed === '0.00' && !value.isZero()) return `${sign}<$0.01`
  return `${sign}$${grouped(fixed)}`
}

/**
 * Four significant digits below a dollar, because a price is read to its
 * digits and a total is read to the cent. `usd` was doing both, so every
 * k-prefixed Hyperliquid perp — kPEPE, kSHIB, kBONK — showed a liquidation
 * price of `$0.00`, which is the trigger being reported as unreachable.
 *
 * Non-positive is an em dash for the reason `usablePrice` refuses one on the
 * way in: nothing trades at zero, so a zero here is a missing price wearing a
 * figure's clothes.
 */
export function price(value: Decimal | null): string {
  if (value === null || !value.isFinite() || value.lte(0)) return '—'
  // `e` is the exponent of the leading digit, so -e + 3 places puts four
  // significant digits after the point. The cap bounds the column; it sits well
  // below the smallest quote any source publishes, so it cannot be what rounds
  // a price to nothing.
  const dp = value.gte(1) ? 2 : Math.min(30, -value.e + 3)
  const [whole = '0', fraction = ''] = value.toFixed(dp).split('.')
  // Trailing zeros go, but never the cents: `$0.50` is a price and `$0.5` is a
  // typo, and a column of prices is scanned down the decimal point.
  return `$${grouped(whole)}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`
}

/**
 * A ratio, so neither `usd` nor `pct` renders it. Two places is the resolution
 * the difference is argued at — 1.02 and 1.05 are different nights — and the
 * `toFixed(2)` calls that had spread outside this file were a second answer to
 * the same question. Null is Aave's no-debt account: it has no health factor
 * rather than an enormous one.
 */
export function healthFactor(value: Decimal | null): string {
  if (value === null || !value.isFinite()) return '—'
  return value.toFixed(2)
}

/** Signed, because the direction of the move is the whole point. */
export function pct(fraction: Decimal, dp = 1): string {
  if (!fraction.isFinite()) return '—'
  const value = fraction.times(100)
  // `Decimal`'s negative zero is negative and prints unsigned, so a clamped
  // zero move rendered `0.0%` — the one output with no direction on it at all.
  const negative = value.isNegative() && !value.isZero()
  return `${negative ? '-' : '+'}${value.abs().toFixed(dp)}%`
}

/**
 * What a venue is holding, in that venue's own terms. "Position" is right for a
 * perp or a debt and wrong for a token sitting in a wallet: nobody calls their
 * USDC balance a position, and the word implies a counterparty that is not there.
 * Read from the rows rather than the venue, because a CEX holds both.
 */
export function holdings(kind: VenueKind, positions: Position[]): string {
  const leveraged = positions.some((p) => p.kind !== 'spot' && p.kind !== 'pending')
  const noun = leveraged ? 'position' : kind === 'wallet' ? 'token' : 'balance'
  return `${positions.length} ${noun}${positions.length === 1 ? '' : 's'}`
}

/**
 * A download's progress, as one line for the status row. The percentage is what
 * answers "is this nearly done"; the megabytes are what say the number is real
 * and not a spinner that would sit at 99% forever. `null` total is a server
 * that sent no Content-Length, where the bytes are all there is to report.
 */
export function downloaded(received: number, total: number | null): string {
  const mb = (n: number) => (n / 1_000_000).toFixed(1)
  if (!total) return `downloading ${mb(received)} MB`
  return `downloading ${Math.floor((received / total) * 100)}% · ${mb(received)} of ${mb(total)} MB`
}
