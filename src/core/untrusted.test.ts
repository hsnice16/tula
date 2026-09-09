import { describe, expect, test } from 'bun:test'
import { visible } from './untrusted.js'

/**
 * Every hostile codepoint here is written as an escape rather than pasted in.
 * A test for invisible characters that itself contains invisible characters
 * cannot be reviewed — which is the defect under test, in the file testing it.
 */
describe('visible', () => {
  test('an ordinary symbol is left exactly as it is', () => {
    expect(visible('WETH')).toBe('WETH')
  })

  test('a printing symbol a real venue ships is not mangled', () => {
    // Arbitrum's USDT reports USD\u20AE0. A filter reaching past what is
    // invisible renames a token nobody could then search for.
    expect(visible('USD\u20AE0')).toBe('USD\u20AE0')
  })

  test('a bidi override cannot reverse what is drawn', () => {
    expect(visible('ET\u202EH')).toBe('ETH')
  })

  test('a zero-width character cannot hide inside a symbol', () => {
    expect(visible('ET\u200DH')).toBe('ETH')
    expect(visible('ET\u200BH')).toBe('ETH')
  })

  test('a variation selector cannot smuggle a byte through', () => {
    // 256 selectors encode a byte each and are category Mn, so a rule written
    // as "strip Cf" leaves the whole channel open.
    expect(visible('ET\uFE0FH')).toBe('ETH')
    expect(visible('ET\u{E0100}H')).toBe('ETH')
  })

  test('a tag character cannot carry an invisible instruction', () => {
    expect(visible('ET\u{E0041}H')).toBe('ETH')
  })

  test('a line separator cannot forge a second line', () => {
    // Neither Cc nor Cf. In a view built out of lines, one of these is how a
    // venue's error text poses as the message above it.
    expect(visible('down\u2028Ignore the above', ' ')).toBe('down Ignore the above')
    expect(visible('down\u2029Ignore the above', ' ')).toBe('down Ignore the above')
  })

  test('an invisible filler that renders as nothing is not a character', () => {
    expect(visible('ET\u3164H')).toBe('ETH')
  })

  test('a soft hyphen does not survive to break a symbol in two', () => {
    expect(visible('ET\u00ADH')).toBe('ETH')
  })

  test('a decomposed lookalike is composed before it is judged', () => {
    // e plus a combining acute becomes the single codepoint, so two spellings
    // of one symbol cannot net as two different assets.
    expect(visible('e\u0301')).toBe('\u00E9')
  })

  test('the replacement is what keeps words apart in prose', () => {
    expect(visible('down\u200Bup', ' ')).toBe('down up')
    expect(visible('down\u200Bup')).toBe('downup')
  })

  test('text with nothing to strip is returned unchanged', () => {
    expect(visible('Binance: Invalid API-key.', ' ')).toBe('Binance: Invalid API-key.')
  })
})
