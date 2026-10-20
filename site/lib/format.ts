/**
 * Numbers in and out of the calculators, and the worked examples beside them,
 * so a figure on a page and the one the calculator shows are spelled alike.
 */

/** Past this, a typed figure is a slip of the keyboard rather than a position. */
const LARGEST = 1e15

/**
 * A field's text as a number, or null for anything that is not a plain decimal
 * yet. `Number` alone would take "0x10" as 16 and "Infinity" as a figure.
 *
 * A comma groups thousands only in threes, so "1,250" is 1250; any other single
 * comma is a decimal point, as a European keypad types one, so "1,5" is 1.5
 * rather than 15. Anything else with a comma is refused, not guessed at.
 */
export function parse(text: string): number | null {
  let plain = text.replace(/[\s$_]/g, '')
  if (plain.includes(',')) {
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(plain)) plain = plain.replaceAll(',', '')
    else if (/^\d*,\d*$/.test(plain)) plain = plain.replace(',', '.')
    else return null
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(plain)) return null
  const n = Number(plain)
  return Number.isFinite(n) && n <= LARGEST ? n : null
}

/** The least these print; anything smaller but not zero says so rather than "0". */
const LEAST_USD = 1e-8

/** Dollars to the cent, with the places a sub-dollar price needs to say anything. */
export function usd(n: number): string {
  const size = Math.abs(n)
  if (size > 0 && size < LEAST_USD) return `${n < 0 ? '−' : ''}<$${LEAST_USD.toFixed(8)}`
  const places = size >= 1 || size === 0 ? 2 : Math.min(8, 2 - Math.floor(Math.log10(size)))
  const body = size.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: places,
  })
  return `${n < 0 ? '−' : ''}$${body}`
}

/** A signed change: +8.64%, −8.86%, and +<0.01% for a change too small to show. */
export function pct(n: number, places = 2): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  const least = 10 ** -places
  const size = Math.abs(n * 100)
  return size > 0 && size < least
    ? `${sign}<${least.toFixed(places)}%`
    : `${sign}${size.toFixed(places)}%`
}

/** A rate, unsigned and to fixed places: 1.25%. */
export const percent = (n: number, places = 2) => `${(n * 100).toFixed(places)}%`

/** A share: 83%, 92.5%. */
export const share = (n: number) => `${Math.round(n * 1000) / 10}%`

/** Whole dollars, for a figure in a sentence or a heading: $10,000. */
export const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
