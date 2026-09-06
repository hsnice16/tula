import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { homeRelative } from './paths.js'

/**
 * The banner draws the working directory, and Ink writes text verbatim — so a
 * directory name is a string somebody else may have chosen. Every byte but `/`
 * and NUL is legal in one, which a cloned repository or an unpacked archive can
 * carry onto a machine without its owner ever typing it.
 */
describe('homeRelative', () => {
  const ESC = String.fromCharCode(27)

  test('writes a path under home from the tilde', () => {
    expect(homeRelative(`${homedir()}/Documents/tula`)).toBe('~/Documents/tula')
    expect(homeRelative(homedir())).toBe('~')
  })

  test('leaves a path outside home alone', () => {
    expect(homeRelative('/usr/local/bin')).toBe('/usr/local/bin')
  })

  // The name is not a prefix of home, and matching on the bare string would
  // rewrite a sibling directory as though it sat inside it.
  test('a sibling of home is not inside it', () => {
    expect(homeRelative(`${homedir()}-backup/x`)).toBe(`${homedir()}-backup/x`)
  })

  test('an escape sequence in a directory name never reaches the screen', () => {
    const evil = `/tmp/${ESC}[2K\rtula v9.9.9  CONNECTED: kraken`
    const out = homeRelative(evil)
    expect(out).not.toContain(ESC)
    expect(out).not.toContain('\r')
  })

  test('a path too long to sit beside the mark is elided from the head', () => {
    const out = homeRelative(`/x/${'a'.repeat(4096)}/tail`)
    expect(out.length).toBeLessThanOrEqual(64)
    expect(out.startsWith('…')).toBe(true)
    // The tail is what says which directory this is.
    expect(out.endsWith('/tail')).toBe(true)
  })
})
