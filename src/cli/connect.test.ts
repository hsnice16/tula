import { describe, expect, test } from 'bun:test'
import { askFields, type ask } from './prompt.js'
import { aaveConnector } from '../connectors/aave.js'
import { binanceConnector } from '../connectors/binance.js'
import { circleConnector } from '../connectors/circle.js'
import { coinbaseConnector } from '../connectors/coinbase.js'
import { hyperliquidConnector } from '../connectors/hyperliquid.js'
import { krakenConnector } from '../connectors/kraken.js'
import { stripeConnector } from '../connectors/stripe.js'
import { walletConnector } from '../connectors/wallet.js'
import { connectable, type Connectable } from '../connectors/types.js'

/**
 * `tula connect <venue>` asked for an API key and an API secret whatever the
 * venue declared. The three that read a public address could not be connected
 * at all — the address landed under `apiKey` and `verifyScope` rejected it as
 * not an address; Coinbase's two fields were stored under the wrong names; and
 * Stripe's and Circle's single restricted key was typed in the clear, because
 * the pair's first prompt was never secret. Each is a property of the field
 * list, so the field list is what this drives.
 */
const CONNECTORS: Connectable[] = [
  walletConnector,
  hyperliquidConnector,
  aaveConnector,
  krakenConnector,
  coinbaseConnector,
  binanceConnector,
  stripeConnector,
  circleConnector,
].map(connectable)

const byId = (id: string): Connectable => {
  const found = CONNECTORS.find((c) => c.id === id)
  if (!found) throw new Error(`no connector ${id}`)
  return found
}

/**
 * One canned answer per prompt, in order, and a record of what each prompt was
 * told about the field it was asking for — which is where the leak was.
 */
interface Prompted {
  label: string
  hidden: boolean
}

function typing(answers: string[]): { prompt: typeof ask; asked: Prompted[] } {
  const asked: Prompted[] = []
  let i = 0
  const prompt = async (label: string, o: { hidden: boolean; command: string }) => {
    asked.push({ label: label.trim(), hidden: o.hidden })
    return answers[i++] ?? ''
  }
  return { prompt, asked }
}

describe('the connect prompts follow the venue, not a fixed pair', () => {
  for (const c of CONNECTORS) {
    test(`${c.id} is asked for exactly the fields it declares`, () => {
      expect(c.fields.length).toBeGreaterThan(0)
      // Every field the flow will store must be one verifyScope reads back.
      for (const f of c.fields) expect(f.name).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/)
    })
  }

  test('an address-only venue declares no secret, so none is asked for as a key', () => {
    for (const c of ['wallet','hyperliquid','aave'].map(byId)) {
      expect(c.fields.map((f) => f.name)).toEqual(['address'])
      expect(c.fields.some((f) => f.secret)).toBe(false)
    }
  })

  // The bug that leaked: a single-field venue whose one field is the secret.
  test('every venue with one field has that field marked secret or an address', () => {
    for (const c of CONNECTORS.filter((c) => c.fields.length === 1)) {
      const only = c.fields[0]
      expect(only?.secret === true || only?.name === 'address').toBe(true)
    }
  })
})

describe('askFields', () => {
  const run = (c: Connectable, answers: string[]) => {
    const { prompt, asked } = typing(answers)
    return {
      asked,
      creds: askFields(c.fields, { command: `tula connect ${c.id}`, log: () => {}, prompt }),
    }
  }

  test('keys the answers by field name, in the order asked', async () => {
    const { creds } = run(byId('coinbase'), ['organizations/o/apiKeys/k', 'PEM'])
    expect(await creds).toEqual({ keyName: 'organizations/o/apiKeys/k', signingKey: 'PEM' })
  })

  test('asks a one-field venue for one value, not two', async () => {
    const { creds, asked } = run(byId('stripe'), ['rk_live_x'])
    expect(await creds).toEqual({ apiKey: 'rk_live_x' })
    // Its own label too: the pair called this "API key", which is not what
    // Stripe calls it and not what the reader is looking at in the dashboard.
    expect(asked).toEqual([{ label: 'Restricted key:', hidden: true }])
  })

  test('an address goes in under `address`, which is what verifyScope reads', async () => {
    const { creds } = run(byId('wallet'), ['0x0000000000000000000000000000000000000abc'])
    expect(await creds).toEqual({ address: '0x0000000000000000000000000000000000000abc' })
  })

  // Stripe's and Circle's only field is the key itself. The pair this replaced
  // never hid its first prompt, so that key was typed onto the screen.
  test('no secret field is ever prompted with echo on', async () => {
    for (const c of CONNECTORS) {
      const { creds, asked } = run(c, c.fields.map((_, i) => `value-${i}`))
      await creds
      expect(asked.map((a) => a.hidden)).toEqual(c.fields.map((f) => f.secret))
    }
  })

  test('names the field that was left blank, rather than "both values"', async () => {
    const { creds } = run(byId('kraken'), [''])
    expect(creds).rejects.toThrow('API key is required.')
  })
})
