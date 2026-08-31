import { describe, expect, test } from 'bun:test'
import { fixtureEngine } from './fixture.js'
import { executeTool, TOOLS } from './tools.js'

const call = (name: string, input: unknown = {}) =>
  executeTool(fixtureEngine, name, input) as Record<string, any>

describe('tool surface', () => {
  test('every tool has a schema the API will accept', () => {
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/)
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.input_schema.type).toBe('object')
    }
  })

  test('an unknown tool is reported, not thrown', () => {
    expect(call('nope').error).toContain('Unknown tool')
  })
})

describe('get_net_exposure', () => {
  test('hands over the netted figure, not the raw legs', () => {
    const eth = call('get_net_exposure', { asset: 'eth' }).exposures[0]
    expect(eth.net_quantity).toBe('8.5')
    expect(eth.venues).toEqual(['cex', 'perp', 'lend'])
  })

  test('every figure arrives rendered, so the model has nothing to round', () => {
    for (const row of call('get_net_exposure').exposures) {
      expect(typeof row.net_quantity).toBe('string')
      expect(row.notional_usd === null || row.notional_usd.startsWith('$')).toBe(true)
      expect(row.as_of).toMatch(/^\d\d:\d\d:\d\d \(\d+[smhd] ago\)$/)
    }
  })

  test('an unpriced asset reports null notional and says what that means', () => {
    const result = call('get_net_exposure', { asset: 'XYZ' })
    expect(result.exposures[0].notional_usd).toBeNull()
    expect(result.note).toContain('not zero')
  })
})

describe('what_breaks_first', () => {
  test('nearest first, with the trigger that produced it', () => {
    const risks = call('what_breaks_first').risks
    expect(risks[0].venue).toBe('lend')
    expect(risks[0].health_factor).toBe('1.42')
    expect(risks[0].move_to_liquidation).toMatch(/^-\d/)
    expect(risks[1].move_to_liquidation).toMatch(/^\+\d/)
  })
})

describe('run_scenario', () => {
  test('converts percent to a fraction and names what liquidates', () => {
    const result = call('run_scenario', { shocks: [{ asset: 'ETH', percent: -35 }] })
    expect(result.liquidated).toEqual([{ venue: 'lend', kind: 'collateral', asset: 'ETH' }])
    expect(result.change_usd).toMatch(/^-\$/)
  })

  test('a survivable shock liquidates nothing', () => {
    expect(call('run_scenario', { shocks: [{ asset: 'ETH', percent: -10 }] }).liquidated).toEqual([])
  })

  test('unpriced assets are named as excluded', () => {
    expect(call('run_scenario', { shocks: [{ asset: 'ETH', percent: -10 }] }).unpriced_and_excluded).toEqual(['XYZ'])
  })

  test('malformed shocks are refused rather than guessed at', () => {
    expect(call('run_scenario', { shocks: [{ asset: 'ETH' }] }).error).toContain('signed percent')
  })
})

describe('get_venue_status', () => {
  test('surfaces failed venues so the model can qualify its answer', () => {
    const result = call('get_venue_status')
    expect(result.failed_venues).toEqual(['binance: credentials missing'])
    expect(result.venues).toHaveLength(3)
    expect(result.note).toBeUndefined()
  })

  test('nothing connected reads as a connection gap, with the way out', () => {
    const empty = executeTool(
      { ...fixtureEngine, venues: () => [], freshness: () => ({ oldest: null, loadedAt: new Date(), failures: [], priceError: null }) },
      'get_venue_status',
      {},
    ) as Record<string, any>
    expect(empty.venues).toEqual([])
    expect(empty.note).toContain('/')
  })
})
