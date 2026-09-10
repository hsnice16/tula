import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import Decimal from 'decimal.js'
import { cashLegError, hyperliquidConnector, MARGIN_ID, unscale } from './hyperliquid.js'

const ADDRESS = '0x0000000000000000000000000000000000000abc'

/**
 * Real answers from api.hyperliquid.xyz, captured by `scripts/capture-onchain.ts`
 * with the addresses replaced and every amount scaled by one factor per account
 * — so nothing here may be asserted against an absolute magnitude, only against
 * a relation the scaling leaves exact. Invented ones could
 * only ever agree with us: the fixture this file used to carry omitted
 * `totalNtlPos`, so it held no arithmetic that could contradict what the
 * connector believed `totalRawUsd` was, and the tests could assert only that
 * the USDC row was not two other numbers.
 */
const DIR = new URL('../../fixtures/hyperliquid/', import.meta.url).pathname

interface Fixture {
  name: string
  perps: Record<string, unknown>
  spot: { balances?: Array<{ coin: string; total: string }> }
}

const ACCOUNTS: Fixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'perp-dexs.json')
  .map((f) => ({ name: f.replace('.json', ''), ...JSON.parse(readFileSync(`${DIR}${f}`, 'utf8')) }))

const named = (name: string): Fixture => {
  const found = ACCOUNTS.find((a) => a.name === name)
  if (!found) throw new Error(`fixture ${name} is missing; run scripts/capture-onchain.ts`)
  return found
}

const original = globalThis.fetch

/** Every `type` the connector sent, in order — what it asked is a fact to assert on. */
let asked: string[] = []

function stub(perps: unknown, spot: unknown = { balances: [] }): void {
  asked = []
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}')
    asked.push(body.type)
    const answer = body.type === 'spotClearinghouseState' ? spot : perps
    return new Response(JSON.stringify(answer), { status: 200 })
  }) as unknown as typeof fetch
}

const stubAccount = (fixture: Fixture): void => stub(fixture.perps, fixture.spot)

const positions = (): Promise<
  Awaited<ReturnType<typeof hyperliquidConnector.fetchPositions>>
> => hyperliquidConnector.fetchPositions({ address: ADDRESS })

afterEach(() => {
  globalThis.fetch = original
})

describe('what Hyperliquid says about itself', () => {
  test('the capture is not empty, so an absent fixture cannot pass every test below', () => {
    expect(ACCOUNTS.length).toBeGreaterThanOrEqual(4)
    for (const shape of ['perp-short', 'perp-long', 'spot-only', 'empty']) {
      expect(ACCOUNTS.map((a) => a.name)).toContain(shape)
    }
  })

  // accountValue = totalRawUsd + Σ sign(szi) × positionValue, on every account
  // captured. This is the assertion that was missing: it is what says
  // `totalRawUsd` is the cash leg of the perp book rather than a deposit, and a
  // fixture that broke it would mean the connector's USDC row is wrong.
  for (const account of ACCOUNTS) {
    test(`${account.name}: the venue's own identity holds, so the cash leg is not a balance`, () => {
      const off = cashLegError(account.perps)
      expect(off).not.toBeNull()
      expect(off?.abs().lessThan('0.000001')).toBe(true)
    })
  }

  test('a leveraged long carries a negative cash leg, which no balance ever does', () => {
    const summary = named('perp-long').perps['marginSummary'] as { totalRawUsd: string }
    expect(new Decimal(summary.totalRawUsd).isNegative()).toBe(true)
  })

  /**
   * The identity above reads sign(szi) and nothing else, so a size scaled by a
   * factor of its own satisfies it — and every amount in these fixtures is
   * scaled, by one factor per account. What reads the magnitude is the price
   * the venue liquidates it at:
   *
   *   liquidationPx = positionValue/|szi|
   *                   − sign(szi) × A / (|szi| × (1 − sign(szi)/(2·maxLeverage)))
   *   where A = spot USDC total − crossMaintenanceMarginUsed
   *
   * Every term is degree zero in the amounts, which is why one shared factor
   * leaves it exact — and why a per-field slip in `capture-onchain.ts`, or a
   * connector that rescales a size, breaks it. It spans both halves of the
   * capture, so it also fails if the perp and spot books were scaled apart.
   */
  interface Perp {
    coin: string
    szi: string
    positionValue: string
    liquidationPx: string | null
    maxLeverage: number
    leverage?: { type?: string }
    marginUsed?: string
  }

  /**
   * Cross legs only. The relation above measures a leg against the *shared*
   * pool — spot USDC less the cross maintenance margin — and an isolated leg is
   * priced out of the margin posted to it alone. Run over one, it reports the
   * venue's own stated price as wrong by 22%: `perp-isolated`'s BTC leg is
   * stated at 76,385 and the cross formula gives 59,397. That difference is not
   * a capture fault, it is the split `hyperliquid.ts` declares it does not read.
   */
  const liquidations = (account: Fixture): Perp[] =>
    ((account.perps['assetPositions'] ?? []) as Array<{ position: Perp }>)
      .map((entry) => entry.position)
      .filter((p) => p.liquidationPx !== null && p.liquidationPx !== undefined)
      .filter((p) => p.leverage?.type !== 'isolated')

  /**
   * How far the venue's arithmetic may sit from ours. It prints liquidationPx
   * to ten decimals, so a disagreement in the tenth is its printing; above that
   * the residual is its own float. One relative tolerance loose enough for
   * kSHIB at $0.41 would let BCH at $6,411 be wrong in its sixth figure.
   */
  const tolerance = (px: Decimal): Decimal => new Decimal('1e-10').plus(px.abs().times('2e-12'))

  test('the capture still states liquidation prices, or the relation below prices nothing', () => {
    expect(ACCOUNTS.flatMap(liquidations).length).toBeGreaterThanOrEqual(10)
  })

  for (const account of ACCOUNTS) {
    const priced = liquidations(account)
    if (priced.length === 0) continue
    test(`${account.name}: the venue reprices every |szi|, so a mis-scaled size cannot pass`, () => {
      const usdc = (account.spot.balances ?? []).find((b) => b.coin === 'USDC')
      const free = new Decimal(usdc?.total ?? '0').minus(
        account.perps['crossMaintenanceMarginUsed'] as string,
      )
      const off = priced.flatMap((p) => {
        const size = new Decimal(p.szi).abs()
        const sign = new Decimal(p.szi).isNegative() ? -1 : 1
        const maintenance = new Decimal(1).minus(new Decimal(sign).div(p.maxLeverage * 2))
        const ours = new Decimal(p.positionValue)
          .div(size)
          .minus(free.times(sign).div(size.times(maintenance)))
        const stated = new Decimal(p.liquidationPx as string)
        return ours.minus(stated).abs().lessThanOrEqualTo(tolerance(stated))
          ? []
          : [{ coin: p.coin, stated: stated.toString(), ours: ours.toString() }]
      })
      expect(off).toEqual([])
    })
  }
})

/**
 * The account this connector cannot describe, captured so the gap it declares is
 * measured against the venue rather than remembered.
 *
 * No HLP depositor holds an isolated position — 0 of the 99 addresses
 * `capture-onchain.ts` reads — which is why the fixture was missing and the
 * declaration says no captured account had one to measure against.
 */
describe('an account holding an isolated position beside cross ones', () => {
  const account = named('perp-isolated')
  const perps = account.perps as Record<string, { totalMarginUsed?: string }> &
    Record<string, unknown>
  const legs = (account.perps['assetPositions'] as Array<{ position: Record<string, string> & { leverage: { type: string } } }>)
    .map((e) => e.position)

  test('holds both kinds at once, which is the only shape that shows them apart', () => {
    expect(legs.some((p) => p.leverage.type === 'isolated')).toBe(true)
    expect(legs.some((p) => p.leverage.type === 'cross')).toBe(true)
  })

  test('the cross summary excludes the isolated leg, and the whole-account one does not', () => {
    // The arithmetic the declared gap is about, and the reason reading
    // `marginSummary.totalMarginUsed` as the cross pool would overstate it by a
    // whole position's margin. `MARGIN_ID` is built from the cash leg rather
    // than from either of these, which is what keeps the book right today.
    const isolated = legs
      .filter((p) => p.leverage.type === 'isolated')
      .reduce((sum, p) => sum.plus(p['marginUsed'] as string), new Decimal(0))
    const cross = new Decimal((perps['crossMarginSummary'] as { totalMarginUsed: string }).totalMarginUsed)
    const all = new Decimal((perps['marginSummary'] as { totalMarginUsed: string }).totalMarginUsed)
    expect(cross.plus(isolated).minus(all).abs().lessThan('0.000001')).toBe(true)
    expect(isolated.isZero()).toBe(false)
  })

  test('an isolated leg posts margin of its own, which the cash leg does not carve out', async () => {
    stubAccount(account)
    const rows = await positions()
    // One collateral row, the cross cash leg. The isolated margin is neither
    // separated out of it nor added beside it — the declared gap, on an account
    // that actually has one rather than on a doctored fixture.
    expect(rows.filter((p) => p.kind === 'collateral')).toHaveLength(1)
  })
})

describe('the perp account’s cash leg', () => {
  test('is not offered as spendable USDC beside the spot USDC row', async () => {
    stubAccount(named('perp-short'))
    const rows = await positions()
    const margin = rows.find((p) => p.id === MARGIN_ID)
    expect(margin?.kind).toBe('collateral')
    // Reported as spot, this row and the real spot balance were added together
    // and the account read as holding several times its own equity in cash.
    expect(rows.filter((p) => p.asset === 'USDC' && p.kind === 'spot')).toHaveLength(1)
  })

  test('still lands, or the account’s own equity leaves the portfolio', async () => {
    const account = named('perp-short')
    stubAccount(account)
    const rows = await positions()
    const summary = account.perps['marginSummary'] as { accountValue: string; totalRawUsd: string }
    expect(rows.find((p) => p.id === MARGIN_ID)?.quantity.toString()).toBe(
      new Decimal(summary.totalRawUsd).toString(),
    )

    // The decomposition has to stay whole: cash leg plus the signed notional of
    // every perp is the account value the venue states.
    const legs = rows
      .filter((p) => p.kind === 'perp')
      .reduce((sum, p) => {
        const entry = (account.perps['assetPositions'] as Array<{ position: Record<string, string> }>)
          .find((a) => unscale(a.position['coin']!, new Decimal(a.position['szi']!)).asset === p.asset)!
        const notional = new Decimal(entry.position['positionValue']!)
        return sum.plus(p.quantity.isNegative() ? notional.negated() : notional)
      }, new Decimal(0))
    const cash = rows.find((p) => p.id === MARGIN_ID)!.quantity
    expect(cash.plus(legs).minus(summary.accountValue).abs().lessThan('0.000001')).toBe(true)
  })

  test('an account with nothing behind it has no margin row to point at', async () => {
    stubAccount(named('empty'))
    expect(await positions()).toEqual([])
  })

  test('a venue that reports no cash leg falls back to what is withdrawable', async () => {
    stub({ time: 1788115918781, assetPositions: [], marginSummary: {}, withdrawable: '2500.5' })
    const rows = await positions()
    expect(rows.find((p) => p.id === MARGIN_ID)?.quantity.toString()).toBe('2500.5')
  })
})

describe('cross and isolated do not liquidate the same way', () => {
  test('a cross position names the pool it dies with', async () => {
    stubAccount(named('perp-short'))
    const perp = (await positions()).find((p) => p.kind === 'perp')
    expect(perp?.encumbers).toEqual([MARGIN_ID])
  })

  test('an isolated position is not tied to the cross pool it cannot touch', async () => {
    const account = named('perp-short')
    const perps = JSON.parse(JSON.stringify(account.perps)) as {
      assetPositions: Array<{ position: { leverage: { type: string } } }>
    }
    for (const entry of perps.assetPositions) entry.position.leverage.type = 'isolated'
    stub(perps, account.spot)
    const perp = (await positions()).find((p) => p.kind === 'perp')
    expect(perp?.encumbers).toBeUndefined()
  })

  test('nothing is encumbered by a margin row that was never emitted', async () => {
    stub({
      time: 1788115918781,
      marginSummary: { accountValue: '0.0', totalRawUsd: '0.0', totalNtlPos: '0.0' },
      withdrawable: '0.0',
      assetPositions: [
        { position: { coin: 'BTC', szi: '-0.5', leverage: { type: 'cross', value: 20 } } },
      ],
    })
    const rows = await positions()
    const ids = new Set(rows.map((p) => p.id))
    for (const p of rows) for (const id of p.encumbers ?? []) expect(ids.has(id)).toBe(true)
  })
})

describe('one asset, one row', () => {
  test('a coin the venue spells in lower case does not become a second holding', async () => {
    stub(named('empty').perps, {
      balances: [
        { coin: 'purr', total: '100' },
        { coin: 'PURR', total: '20.5' },
      ],
    })
    const rows = await positions()
    expect(new Set(rows.map((p) => p.asset))).toEqual(new Set(['PURR']))
  })

  test('a thousand-multiple perp is unwound so it nets with the same coin elsewhere', () => {
    const { asset, size, scale } = unscale('kPEPE', new Decimal('1.5'))
    expect(asset).toBe('PEPE')
    expect(size.toString()).toBe('1500')
    expect(scale).toBe(1000)
  })
})

describe('perps', () => {
  test('a short stays negative, with the liquidation price the venue states', async () => {
    const account = named('perp-short')
    stubAccount(account)
    const entry = (account.perps['assetPositions'] as Array<{ position: Record<string, string> }>)[0]!
      .position
    const perp = (await positions()).find((p) => p.kind === 'perp')
    expect(perp?.quantity.toString()).toBe(new Decimal(entry['szi']!).toString())
    expect(perp?.quantity.isNegative()).toBe(true)
    expect(perp?.liquidation?.price?.toString()).toBe(new Decimal(entry['liquidationPx']!).toString())
  })

  test('a null liquidation price is absent, never zero', async () => {
    stub({
      time: 1788115918781,
      marginSummary: { accountValue: '10', totalRawUsd: '10', totalNtlPos: '0' },
      assetPositions: [{ position: { coin: 'ATOM', szi: '640.25', liquidationPx: null } }],
    })
    const atom = (await positions()).find((p) => p.asset === 'ATOM')
    expect(atom).toBeDefined()
    expect(atom?.liquidation).toBeUndefined()
  })

  test('zero-size positions and zero balances are dropped', async () => {
    stub(
      {
        time: 1788115918781,
        marginSummary: { accountValue: '0', totalRawUsd: '0', totalNtlPos: '0' },
        assetPositions: [{ position: { coin: 'SOL', szi: '0.0', liquidationPx: '1' } }],
      },
      { balances: [{ coin: 'HYPE', total: '0.0' }] },
    )
    expect(await positions()).toEqual([])
  })

  test('freshness comes from the venue clock, not ours', async () => {
    const account = named('perp-short')
    stubAccount(account)
    for (const p of await positions()) {
      expect(p.asOf.getTime()).toBe(account.perps['time'] as number)
    }
  })
})

describe('scope', () => {
  test('is provably read-only — there is no credential to over-scope', async () => {
    stubAccount(named('empty'))
    expect(await hyperliquidConnector.verifyScope({ address: ADDRESS })).toEqual({
      canRead: true,
      canTrade: false,
      canWithdraw: false,
    })
  })

  test('refuses anything that is not an address, before calling out', async () => {
    stubAccount(named('empty'))
    await expect(hyperliquidConnector.verifyScope({ address: 'my-seed-phrase' })).rejects.toThrow(
      /not an Ethereum address/,
    )
  })
})

// These fail when a gap is closed, which is the point: closing one has to
// delete its line from `coverage.doesNotRead` in the same change, or the
// connector goes on telling the user it cannot see something it now sees.
describe('the gaps this connector declares are still gaps', () => {
  const gap = (fragment: string): void => {
    expect(
      (hyperliquidConnector.coverage?.doesNotRead ?? []).some((g) => g.what.includes(fragment)),
    ).toBe(true)
  }

  test('staking and vault equity are declared unread, and nothing asks for them', async () => {
    gap('staked HYPE')
    stubAccount(named('perp-short'))
    await positions()
    expect(asked).not.toContain('delegatorSummary')
    expect(asked).not.toContain('userVaultEquities')
  })

  test('sub-accounts are declared unread, and nothing asks for them', async () => {
    gap('sub-accounts')
    stubAccount(named('perp-short'))
    await positions()
    expect(asked).not.toContain('subAccounts')
  })

  test('the borrow/lend book is declared unread, and its health factor never arrives', async () => {
    gap('borrow/lend book')
    stubAccount(named('perp-short'))
    await positions()
    expect(asked).not.toContain('borrowLendUserState')
  })

  test('builder perp dexes are declared unread, and no request names one', async () => {
    gap('builder-deployed dexes')
    // Measured against the venue: perpDexs answers with dexes that exist and
    // hold leveraged positions, and every request here asks the first-party
    // book, which is the one that does not carry them.
    const { builders } = JSON.parse(readFileSync(`${DIR}perp-dexs.json`, 'utf8')) as {
      builders: Array<{ name: string }>
    }
    expect(builders.length).toBeGreaterThan(0)

    const sent: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}')
      sent.push(body)
      const account = named('perp-short')
      const answer = body.type === 'spotClearinghouseState' ? account.spot : account.perps
      return new Response(JSON.stringify(answer), { status: 200 })
    }) as unknown as typeof fetch
    await positions()
    for (const request of sent) expect(request['dex']).toBeUndefined()
  })

  /**
   * The one gap here that is not an endpoint but a second chain. The spot
   * balances this connector does read are the HyperCore half of a HyperEVM
   * holding, so a reader who connected Hyperliquid and no wallet address is the
   * one nothing else would tell — `wallet.ts` declares the chain, and the
   * `NOT READ` line only names venues that were connected.
   */
  test('HyperEVM is declared unread, and nothing reaches an EVM node for the other half', async () => {
    gap('HyperEVM')
    const sent: Array<{ url: string; body: Record<string, unknown> }> = []
    globalThis.fetch = (async (url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>
      sent.push({ url: String(url), body })
      const account = named('spot-only')
      return new Response(
        JSON.stringify(body['type'] === 'spotClearinghouseState' ? account.spot : account.perps),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const rows = await positions()
    // Spot rows exist, so this is the case the gap is about rather than an
    // account with nothing in it.
    expect(rows.some((p) => p.kind === 'spot')).toBe(true)
    // Reading the EVM side means a JSON-RPC `method`, and a node to send it to.
    for (const { url, body } of sent) {
      expect(body['method']).toBeUndefined()
      expect(url).toBe('https://api.hyperliquid.xyz/info')
    }
  })

  test('the margin behind an isolated position is declared unread, and none is carved out', async () => {
    gap('margin behind an isolated position')
    const account = named('perp-short')
    const perps = JSON.parse(JSON.stringify(account.perps)) as {
      assetPositions: Array<{ position: { leverage: { type: string }; marginUsed: string } }>
    }
    for (const entry of perps.assetPositions) entry.position.leverage.type = 'isolated'
    stub(perps, account.spot)
    const posted = perps.assetPositions.map((e) => e.position.marginUsed)
    // The cross pool is still the only margin row, so an isolated position's own
    // margin is neither separated out of it nor added beside it.
    const rows = await positions()
    expect(rows.filter((p) => p.kind === 'collateral')).toHaveLength(1)
    for (const p of rows) expect(posted).not.toContain(p.quantity.toString())
  })

  test('a spot balance held against an open order is declared unread, and is not netted off', async () => {
    gap('reserved against a spot balance')
    stub(named('empty').perps, { balances: [{ coin: 'USDC', total: '100', hold: '40' }] })
    const usdc = (await positions()).find((p) => p.asset === 'USDC')
    expect(usdc?.quantity.toString()).toBe('100')
  })
})
