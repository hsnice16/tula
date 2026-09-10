import { describe, expect, test } from 'bun:test'
import { CONNECTORS } from './registry.js'

/**
 * `coverage` is optional on `Connector` for the test doubles alone. A shipped
 * venue that leaves it out contributes no areas to `disclosure()`, so it never
 * reaches the `NOT READ` line and reads as a venue nothing was missed on —
 * the same silence as an undeclared gap, arriving as an omission instead.
 */
describe('a venue added to the build without saying what it cannot see', () => {
  for (const [id, connector] of CONNECTORS) {
    test(`${id} would otherwise read as answered in full`, () => {
      expect(connector.coverage?.reads.length ?? 0).toBeGreaterThan(0)
      expect(connector.coverage?.doesNotRead).toBeDefined()
    })
  }
})
