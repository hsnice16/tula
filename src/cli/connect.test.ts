import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { chmod, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Decimal from 'decimal.js'
import { askFields, type ask } from './prompt.js'
import { CONNECTORS as SHIPPED } from '../connectors/registry.js'
import {
  connectable,
  isOverScoped,
  overScopedPowers,
  type Connectable,
  type Connector,
  type KeyScope,
} from '../connectors/types.js'
import type { Position } from '../core/position.js'
import type { PriceOracle } from '../core/prices.js'
import * as secrets from '../secrets/store.js'
import { Session } from './session.js'
import { dispatchCommand } from './shell.js'
import { parseCommand } from './registry.js'

/**
 * `tula connect <venue>` asked for an API key and an API secret whatever the
 * venue declared. The three that read a public address could not be connected
 * at all — the address landed under `apiKey` and `verifyScope` rejected it as
 * not an address; Coinbase's two fields were stored under the wrong names; and
 * Stripe's single restricted key was typed in the clear, because
 * the pair's first prompt was never secret. Each is a property of the field
 * list, so the field list is what this drives.
 */
const CONNECTORS: Connectable[] = [...SHIPPED.values()].map(connectable)

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
    const single = CONNECTORS.filter((c) => c.fields.length === 1)
    // A build with no single-field venue left runs this loop none times and
    // reports the bug fixed. Stripe is the one it leaked on, so its being in
    // here is what says the loop reached the case at all.
    expect(single.map((c) => c.id)).toContain('stripe')
    for (const c of single) {
      const only = c.fields[0]
      expect(only?.secret === true || only?.name === 'address').toBe(true)
    }
  })
})

describe('a refused key is told which power got it refused', () => {
  const powers: (keyof KeyScope)[] = ['canTrade', 'canWithdraw', 'canMoveFunds']

  test.each(powers)('a key that can only %s is refused by a sentence that names it', (power) => {
    const scope = { canRead: true, canTrade: false, canWithdraw: false, [power]: true } as KeyScope
    expect(isOverScoped(scope)).toBe(true)
    // The failure this pins: `isOverScoped` counted `canMoveFunds` while the
    // two refusals composed their sentence from a list of their own that did
    // not, so such a key was refused as "it can ." — a problem with no name.
    expect(overScopedPowers(scope).join(' and ')).not.toBe('')
  })

  test.each(['../index.ts', '../ui/ConnectFlow.tsx'])(
    'the refusal in %s reads the powers off the one function rather than listing its own',
    (file) => {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source).toContain('overScopedPowers(scope)')
      expect(source).not.toMatch(/scope\.canTrade === true &&/)
    },
  )
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

  // Stripe's only field is the key itself. The pair this replaced
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

/**
 * What a second address is worth is decided by what `src/cli/session.ts`
 * fetches with, not by what the store contains.
 *
 * That distinction is the defect this wave already produced once: `put` began
 * appending while the session still read the first entry, so a rotated key was
 * filed behind the dead one and the venue went on failing for days. So every
 * test below drives a real `Session` over a real store and asserts on the book
 * that comes out — never on which function the connect path happens to call.
 */
const oracle: PriceOracle = {
  source: 'test',
  quote: async () => null,
  quoteMany: async () => new Map(),
}

/** A wallet whose rows depend on the address it was handed. */
function watching(id: string, holdings: Record<string, string>): Connector {
  return {
    venue: { id, kind: 'wallet', name: `${id} wallet` },
    fields: [{ name: 'address', label: 'Address', secret: false }],
    help: [],
    async verifyScope() {
      return { canRead: true, canTrade: false as const, canWithdraw: false as const }
    },
    async fetchPositions(creds): Promise<Position[]> {
      const address = creds['address'] ?? ''
      const quantity = holdings[address]
      if (quantity === undefined) throw new Error(`no node would answer for ${address}`)
      return [
        {
          id: `${id}:spot:ETH`,
          venue: id,
          kind: 'spot',
          asset: 'ETH',
          quantity: new Decimal(quantity),
          delta: new Decimal(quantity),
          asOf: new Date(),
        },
      ]
    },
  }
}

const HOT = '0xAaAa'
const COLD = '0xBbBb'

describe('a venue watching more than one address', () => {
  const wallet = watching('spare', { [HOT]: '2', [COLD]: '5' })
  const connectors = new Map<string, Connector>([['spare', wallet]])

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tula-connect-'))
    await chmod(dir, 0o700)
    process.env['TULA_CONFIG_DIR'] = dir
  })

  const load = async (): Promise<Session> => {
    const session = new Session(connectors, oracle)
    await session.refresh()
    return session
  }

  // The whole point of the reshape, and the thing nothing consumed: a wallet
  // stored second was money the book never counted.
  test('the second address is read too, not left out of the book', async () => {
    await secrets.put('spare', { address: HOT })
    await secrets.put('spare', { address: COLD })
    const { positions, failures } = (await load()).current
    expect(failures).toEqual([])
    expect(positions.map((p) => p.quantity.toString()).sort()).toEqual(['2', '5'])
  })

  // A figure nobody can trace to a wallet cannot be acted on: `breaks` naming
  // a venue with three addresses in it says nothing about which to go and fix.
  test('every row names the address it came from', async () => {
    await secrets.put('spare', { address: HOT }, 'hot')
    await secrets.put('spare', { address: COLD })
    const { positions } = (await load()).current
    expect(positions.map((p) => p.account?.label).sort()).toEqual([COLD, `hot (${HOT})`])
    // The label is a name and an address — never anything the credential keeps
    // secret, because it is drawn on screen and returned in a tool result.
    for (const p of positions) expect(p.account?.id).toMatch(/^[0-9a-f]{8}$/)
  })

  // Two addresses on one venue both holding ETH arrive from the connector as
  // the same `spare:spot:ETH`. Anything keyed on that id — the map that hands
  // each row its liquidation distance — then gives one address's answer to the
  // other's row, which is a wrong number wearing the right one's name.
  test('two addresses holding the same asset are two rows, not one id twice', async () => {
    await secrets.put('spare', { address: HOT })
    await secrets.put('spare', { address: COLD })
    const { positions } = (await load()).current
    expect(new Set(positions.map((p) => p.id)).size).toBe(2)
  })

  // The venue is what somebody connected, and what the menu, the status line
  // and `/venues` all count. One row per address would report a book spread
  // over venues nobody has heard of.
  test('a venue holding three addresses is still one venue', async () => {
    for (const address of [HOT, COLD, '0xCcCc']) {
      await secrets.put('spare', { address }).catch(() => {})
    }
    const session = await load()
    expect(session.current.connected).toEqual(['spare'])
  })

  test('one address failing leaves the others on the book, and the failure says which went', async () => {
    await secrets.put('spare', { address: HOT }, 'hot')
    await secrets.put('spare', { address: '0xDead' }, 'gone')
    const { positions, failures } = (await load()).current
    expect(positions.map((p) => p.quantity.toString())).toEqual(['2'])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('gone (0xDead)')
    // The venue id stays the whole of the prefix: `commands.ts` reads a failure
    // back by it, and a venue named `spare (gone…)` renders as one that never
    // failed at all.
    expect(failures[0]?.startsWith('spare: ')).toBe(true)
  })

  // The venue most people have holds one address, and naming it on every
  // failure line is forty characters answering a question nobody asked.
  test('one address alone is not labelled, on the row or in the failure', async () => {
    await secrets.put('spare', { address: HOT })
    const held = (await load()).current
    expect(held.positions[0]?.account).toBeUndefined()

    process.env['TULA_CONFIG_DIR'] = await mkdtemp(join(tmpdir(), 'tula-connect-'))
    await chmod(process.env['TULA_CONFIG_DIR'] as string, 0o700)
    await secrets.put('spare', { address: '0xDead' })
    const failed = (await load()).current
    expect(failed.failures[0]?.startsWith('spare: no node would answer')).toBe(true)
  })

  // Two entries for one account double every holding in it, which is worse than
  // the gap having only one closed.
  test('the same address twice is refused, and the venue still reads the one it had', async () => {
    await secrets.put('spare', { address: HOT })
    expect(secrets.put('spare', { address: HOT.toLowerCase() })).rejects.toThrow(/already holds/)
    const { positions } = (await load()).current
    expect(positions.map((p) => p.quantity.toString())).toEqual(['2'])
  })

  const run = async (session: Session, line: string) => {
    const parsed = parseCommand(line, [...connectors.keys()])
    if (!parsed) throw new Error(`not a command: ${line}`)
    const entries = [{ id: 'spare', connected: true, detail: '', addressOnly: true }]
    const result = await dispatchCommand(session, connectors, parsed, entries)
    if (result.kind !== 'output') throw new Error(`${line} did not answer with output`)
    return result
  }

  test('disconnecting one address drops only that address, rows and all', async () => {
    await secrets.put('spare', { address: HOT }, 'hot')
    await secrets.put('spare', { address: COLD }, 'cold')
    const session = await load()

    const { output } = await run(session, '/spare disconnect cold')
    expect(output).toContain(`cold (${COLD})`)
    expect(session.current.positions.map((p) => p.quantity.toString())).toEqual(['2'])
    expect(await secrets.listVenues()).toEqual(['spare'])
    expect((await secrets.listCredentials('spare')).map((e) => e.name)).toEqual(['hot'])
  })

  // Choosing for them is how the wrong wallet goes. `/forget` is the spelling
  // that means all of them, and it has its own gate.
  test('disconnecting a venue holding several refuses to guess which one', async () => {
    await secrets.put('spare', { address: HOT }, 'hot')
    await secrets.put('spare', { address: COLD }, 'cold')
    const session = await load()

    const result = await run(session, '/spare disconnect')
    expect(result.usageError).toBe(true)
    expect(result.output).toContain('/spare disconnect hot')
    expect(result.output).toContain('/spare disconnect cold')
    expect(await secrets.listCredentials('spare')).toHaveLength(2)
  })

  test('disconnecting an address that is not there names the ones that are', async () => {
    await secrets.put('spare', { address: HOT }, 'hot')
    const session = await load()
    const result = await run(session, '/spare disconnect vault')
    expect(result.usageError).toBe(true)
    expect(result.output).toContain(`hot (${HOT})`)
    expect(await secrets.listCredentials('spare')).toHaveLength(1)
  })
})
