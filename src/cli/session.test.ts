import { expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONNECTORS } from '../connectors/registry.js'
import type { Connector, Refresh } from '../connectors/types.js'
import type { PriceOracle } from '../core/prices.js'
import * as secrets from '../secrets/store.js'
import { Session } from './session.js'

const oracle: PriceOracle = {
  source: 'test',
  quote: async () => null,
  quoteMany: async () => new Map(),
}

test('one refresh hands every address of a venue the same scope, and the next refresh a new one', async () => {
  process.env['TULA_CONFIG_DIR'] = await mkdtemp(join(tmpdir(), 'tula-session-'))
  await secrets.put('hyperliquid', { address: '0xabc' }, 'hot')
  await secrets.put('hyperliquid', { address: '0xdef' }, 'vault')
  const seen: (Refresh | undefined)[] = []
  const connector: Connector = {
    ...CONNECTORS.get('hyperliquid')!,
    fetchPositions: async (_creds, refresh) => {
      seen.push(refresh)
      return []
    },
  }
  const session = new Session(new Map([['hyperliquid', connector]]), oracle)

  await session.refresh()
  await session.refresh()

  expect(seen).toHaveLength(4)
  expect(seen[0]).toBeDefined()
  expect(seen[1]).toBe(seen[0])
  expect(seen[3]).toBe(seen[2])
  expect(seen[2]).not.toBe(seen[0])
})
