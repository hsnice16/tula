import type Decimal from 'decimal.js'
import type { Position, VenueKind } from './position.js'

/**
 * Trailing zeros are stripped so a column of quantities is scanned by its
 * digits rather than by padding. Small balances keep more places: 8dp is the
 * satoshi/wei-adjacent floor below which a holding rounds away to nothing.
 */
export function quantity(value: Decimal): string {
  const dp = value.abs().gte(1) ? 4 : 8
  const fixed = value.toFixed(dp)
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

/**
 * Absolute time plus age. A bare clock hides that a venue stopped responding
 * an hour ago, and a bare age hides which snapshot you are looking at.
 *
 * Days are a separate unit rather than more hours: "72h ago" reads as a long
 * number, "3d ago" reads as an alarm, and that is the one it should read as.
 */
export function freshness(asOf: Date, now: Date = new Date()): string {
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

/** An em dash for null, never `$0.00`: an unknown price is not a zero value. */
export function usd(value: Decimal | null): string {
  if (value === null) return '—'
  const negative = value.isNegative()
  const body = value
    .abs()
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}$${body}`
}

/** Signed, because the direction of the move is the whole point. */
export function pct(fraction: Decimal, dp = 1): string {
  const value = fraction.times(100)
  return `${value.isNegative() ? '' : '+'}${value.toFixed(dp)}%`
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
