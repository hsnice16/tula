import { describe, expect, test } from 'bun:test'
import { isNewer } from './version.js'

describe('comparing releases', () => {
  test('a bigger number is newer, whichever position it is in', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('0.1.1', '0.1.0')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
  })

  // Text sorting puts 0.10.0 before 0.9.0, which would offer somebody on 0.10.0
  // a downgrade and call it an update.
  test('parts compare as numbers, not as text', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('0.9.0', '0.10.0')).toBe(false)
  })

  test('the same version is not newer than itself, in either direction', () => {
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.1.0', '0.1.0.0')).toBe(false)
  })

  test('older is never offered', () => {
    expect(isNewer('0.1.0', '0.2.0')).toBe(false)
  })

  /**
   * `/releases/latest` skips pre-releases, so somebody running `0.2.0-rc.1` is
   * offered the newest stable — which may be `0.1.0`, behind what they have.
   * The comparison is the only thing standing between them and a silent
   * downgrade dressed as an update.
   */
  test('a pre-release sits below the version it leads to', () => {
    expect(isNewer('0.2.0', '0.2.0-rc.1')).toBe(true)
    expect(isNewer('0.2.0-rc.1', '0.2.0')).toBe(false)
    expect(isNewer('0.1.0', '0.2.0-rc.1')).toBe(false)
  })

  test('a leading v is not part of the number', () => {
    expect(isNewer('v0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.2.0', 'v0.2.0')).toBe(false)
    expect(isNewer('v0.2.0', 'v0.1.0')).toBe(true)
  })
})
