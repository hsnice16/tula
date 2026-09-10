import { describe, expect, test } from 'bun:test'
import { CONNECTORS } from '../connectors/registry.js'
import { PRICE_PROVIDERS } from '../prices/providers.js'
import { brandColor } from './brand.js'

const SHIPPED = [
  ...[...CONNECTORS.values()].map((c) => c.venue.id),
  ...PRICE_PROVIDERS.map((p) => p.id),
]

describe('brandColor', () => {
  // A venue added without a mark renders a blank gutter beside every venue that
  // has one, which reads as a broken row rather than as a missing colour.
  test.each(SHIPPED)('%s has a mark', (id) => {
    expect(brandColor(id)).toMatch(/^#[0-9a-f]{6}$/)
  })

  test('a subcommand takes its venue’s mark', () => {
    expect(brandColor('kraken positions')).toBe(brandColor('kraken'))
  })

  test('a command that names no third party has no mark', () => {
    for (const name of ['breaks', 'exposure', 'shock', 'help', 'about']) {
      expect(brandColor(name)).toBeUndefined()
    }
  })
})
