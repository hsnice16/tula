import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import {
  availability,
  claimed,
  constrained,
  overclaimed,
  RELEASES,
  type VenueFacts,
} from './availability.js'
import { netExposure } from './exposure.js'
import type { Position, PositionKind } from './position.js'

const d = (v: string) => new Decimal(v)
const AS_OF = new Date('2026-09-01T09:00:00Z')

function at(
  venue: string,
  kind: PositionKind,
  asset: string,
  quantity: string,
  extra: Partial<Position> = {},
): Position {
  const q = d(quantity)
  return { id: `${venue}:${kind}:${asset}`, venue, kind, asset, quantity: q, delta: q, asOf: AS_OF, ...extra }
}

/** Ten ETH supplied against USDC debt, at the health factor the market states. */
const lending = (healthFactor: string): Position[] => [
  at('aave', 'collateral', 'ETH', '10', {
    liquidation: { healthFactor: d(healthFactor), liquidationThreshold: d('0.83') },
  }),
  at('aave', 'debt', 'USDC', '-18000', { encumbers: ['aave:collateral:ETH'] }),
]

const of = (positions: Position[], facts: Record<string, VenueFacts> = {}) =>
  new Map(availability(positions, new Map(Object.entries(facts))).map((a) => [a.position.id, a]))

const cex: VenueFacts = { kind: 'cex', freeUnprovable: null }

describe('what a holding is actually free to do', () => {
  test('collateral securing a debt is not offered as cash', () => {
    const eth = of(lending('2.5')).get('aave:collateral:ETH')
    expect(eth?.free?.toString()).toBe('6')
    expect(claimed(eth!).toString()).toBe('4')
  })

  test('ten with four pledged is four unavailable and six free, not ten of either', () => {
    // All-or-nothing is the shape this used to take: a leg was either pledged
    // or it was not, and a book one withdrawal from healthy read as untouchable.
    const eth = of(lending('2.5')).get('aave:collateral:ETH')!
    expect(eth.free?.plus(claimed(eth)).toString()).toBe('10')
    expect(eth.claims).toHaveLength(1)
  })

  test('free plus unavailable is the whole holding wherever both are known', () => {
    const book = [
      ...lending('1.6'),
      at('binance', 'spot', 'ETH', '3'),
      at('binance', 'pending', 'ETH', '1'),
      at('kraken', 'staked', 'DOT', '310.5'),
    ]
    for (const a of availability(book, new Map([['binance', cex]]))) {
      if (a.free === null) continue
      expect(a.free.plus(claimed(a)).toString()).toBe(a.position.quantity.toString())
    }
  })

  test('a hold at one venue does not claim the same asset at another', () => {
    // Availability is venue-local, and two claims on one symbol are two claims:
    // ETH pledged at Aave says nothing about ETH sitting in a wallet.
    const rows = of([...lending('2.5'), at('wallet', 'spot', 'ETH', '5')])
    expect(rows.get('wallet:spot:ETH')?.free?.toString()).toBe('5')
    expect(claimed(rows.get('aave:collateral:ETH')!).toString()).toBe('4')
  })

  test('the same asset pledged at two venues subtracts both', () => {
    const rows = of([
      ...lending('2.5'),
      at('hyperliquid', 'collateral', 'ETH', '2', { id: 'hl:margin' }),
      at('hyperliquid', 'perp', 'BTC', '1', { encumbers: ['hl:margin'] }),
    ])
    expect(claimed(rows.get('aave:collateral:ETH')!).toString()).toBe('4')
    expect(claimed(rows.get('hl:margin')!).toString()).toBe('2')
  })

  test('two debts in one market do not subtract the same collateral twice', () => {
    // A health factor already covers every debt in its market, so a claim per
    // debt would take the collateral out of the book twice over.
    const eth = of([
      ...lending('2.5'),
      at('aave', 'debt', 'DAI', '-2000', { encumbers: ['aave:collateral:ETH'] }),
    ]).get('aave:collateral:ETH')!
    expect(eth.free?.toString()).toBe('6')
    expect(claimed(eth).toString()).toBe('4')
  })

  test('a long perp is not offered as a balance somebody could move', () => {
    // It is exposure, not a quantity of anything sitting anywhere. Reported as
    // free it would read as cash the size of the whole position.
    expect(of([at('hyperliquid', 'perp', 'ETH', '1.5')]).get('hyperliquid:perp:ETH')).toBeUndefined()
  })

  test('a debt is not a holding with a free figure of its own', () => {
    expect(of(lending('2.5')).get('aave:debt:USDC')).toBeUndefined()
  })
})

describe('exposure is not availability', () => {
  test('a pledged asset moves with its price exactly as an unpledged one does', () => {
    // The failure this prevents is silent and total: a free figure that reached
    // `delta` would shrink every exposure in the book by whatever was pledged.
    const book = lending('2.5')
    const before = netExposure(book, new Map([['ETH', d('4000')]]))
    availability(book)
    const after = netExposure(book, new Map([['ETH', d('4000')]]))
    expect(after.map((e) => e.delta.toString())).toEqual(before.map((e) => e.delta.toString()))
    expect(after.find((e) => e.asset === 'ETH')?.delta.toString()).toBe('10')
  })

  test('the split is a quantity, so a holding nobody priced still has one', () => {
    // `notional` being null says nothing about what is pledged, and a split
    // that waited for a price would answer nothing for an unlisted token.
    const eth = of(lending('2.5')).get('aave:collateral:ETH')
    expect(eth?.free?.toString()).toBe('6')
  })
})

describe('what cannot be proven is not answered', () => {
  test('a balance whose hold the venue never reports is unknown, never free', () => {
    // Reporting the total as free is the confident wrong answer `KeyScope`'s
    // tri-state exists to refuse, and it is worse than saying nothing: nobody
    // currently believes tula answers this.
    const rows = of([at('kraken', 'spot', 'USD', '1000')], {
      kraken: { kind: 'cex', freeUnprovable: 'Kraken does not read the free/held split once a margin position is open' },
    })
    const usd = rows.get('kraken:spot:USD')!
    expect(usd.free).toBeNull()
    expect(usd.unprovable).toContain('Kraken')
    expect(constrained(usd)).toBe(true)
  })

  test('collateral whose debt is missing from the book is not called free', () => {
    // An `encumbers` id naming a position nobody read is a gap: the claim is
    // real and only its size is unreadable.
    const rows = of([
      at('aave', 'collateral', 'ETH', '10'),
      at('aave', 'debt', 'USDC', '-1', { encumbers: ['aave:collateral:WBTC'] }),
    ])
    const eth = rows.get('aave:collateral:ETH')!
    expect(eth.free).toBeNull()
    expect(eth.claims).toHaveLength(0)
  })

  test('a market that lost a leg says nothing about the market beside it', () => {
    const rows = of([
      at('aave-prime', 'collateral', 'ETH', '10'),
      at('aave-prime', 'debt', 'USDC', '-1', { encumbers: ['aave-prime:collateral:WBTC'] }),
      at('aave-core', 'spot', 'ETH', '4'),
    ])
    expect(rows.get('aave-prime:collateral:ETH')?.free).toBeNull()
    expect(rows.get('aave-core:spot:ETH')?.free?.toString()).toBe('4')
  })

  test('a venue declaration answers for that venue’s own sub-account labels too', () => {
    // `kraken-main` is a label Kraken writes; the declaration is filed under
    // the venue the user connected, and a lookup by equality falls through it.
    const rows = of([at('kraken-main', 'spot', 'USD', '1000')], {
      kraken: { kind: 'cex', freeUnprovable: 'Kraken does not read it' },
    })
    expect(rows.get('kraken-main:spot:USD')?.free).toBeNull()
  })
})

describe('one venue, two addresses', () => {
  /** The book a venue watching two wallets produces: ids namespaced per
   *  account, and `encumbers` namespaced with them. Nothing here parses one. */
  const wallet = (account: string, healthFactor: string): Position[] => {
    const id = (kind: PositionKind, asset: string) => `${account}:aave:${kind}:${asset}`
    return [
      at('aave', 'collateral', 'ETH', '10', {
        id: id('collateral', 'ETH'),
        account: { id: account, label: `${account} (0x…)` },
        liquidation: { healthFactor: d(healthFactor), liquidationThreshold: d('0.83') },
      }),
      at('aave', 'debt', 'USDC', '-8000', {
        id: id('debt', 'USDC'),
        account: { id: account, label: `${account} (0x…)` },
        encumbers: [id('collateral', 'ETH')],
      }),
    ]
  }

  test('one wallet’s debt does not claim the other wallet’s collateral', () => {
    // Both arrive as ETH at aave. Claimed across the two, one address would be
    // reported as pledged for a loan it never took.
    const rows = of([...wallet('hot', '2.5'), ...wallet('vault', '5')])
    expect(rows.get('hot:aave:collateral:ETH')?.free?.toString()).toBe('6')
    expect(rows.get('vault:aave:collateral:ETH')?.free?.toString()).toBe('8')
  })

  test('a leg missing from one wallet does not blank the wallet beside it', () => {
    // One address failing costs its own rows and no others, here as everywhere.
    const rows = of([
      ...wallet('hot', '2.5'),
      at('aave', 'collateral', 'ETH', '4', {
        id: 'vault:aave:collateral:ETH',
        account: { id: 'vault', label: 'vault (0x…)' },
      }),
      at('aave', 'debt', 'USDC', '-1', {
        id: 'vault:aave:debt:USDC',
        account: { id: 'vault', label: 'vault (0x…)' },
        encumbers: ['vault:aave:collateral:WBTC'],
      }),
    ])
    expect(rows.get('vault:aave:collateral:ETH')?.free).toBeNull()
    expect(rows.get('hot:aave:collateral:ETH')?.free?.toString()).toBe('6')
  })
})

describe('a holding claimed past what it holds', () => {
  test('a health factor under 1 says so rather than clamping to zero', () => {
    // Clamped, the one state the reader most needs to see reads as an ordinary
    // full pledge — a position already liquidatable, drawn as merely locked.
    const eth = of(lending('0.8')).get('aave:collateral:ETH')!
    expect(eth.free?.isNegative()).toBe(true)
    expect(overclaimed(eth)).toBe(true)
    expect(claimed(eth).gt(eth.position.quantity)).toBe(true)
  })

  test('a healthy market is not reported as over-claimed', () => {
    expect(overclaimed(of(lending('2.5')).get('aave:collateral:ETH')!)).toBe(false)
  })
})

describe('what is unavailable names the way out of it', () => {
  test('every reason a row can print carries what releases it', () => {
    // A single "encumbered" bucket tells a reader they cannot act and not what
    // to do — the dead end the conventions forbid.
    const releases = Object.values(RELEASES)
    // `Record<Reason, string>` is what makes the set complete, and a typecheck
    // is what enforces it — which `bun test` does not run. Emptied, the loop
    // below checks nothing and says so in green.
    expect(releases.length).toBeGreaterThan(0)
    for (const release of releases) expect(release.length).toBeGreaterThan(10)
  })

  test('an order hold and an unsettled payout are not given the same advice', () => {
    const held = of([at('binance', 'pending', 'ETH', '1')], { binance: cex })
    const unsettled = of([at('stripe', 'pending', 'USD', '500')], {
      stripe: { kind: 'payments', freeUnprovable: null },
    })
    expect(held.get('binance:pending:ETH')?.claims[0]?.reason).toBe('on hold for an order')
    expect(unsettled.get('stripe:pending:USD')?.claims[0]?.reason).toBe('not settled yet')
    expect(RELEASES['on hold for an order']).toContain('cancel')
    expect(RELEASES['not settled yet']).toContain('wait')
  })

  test('staked is told to wait out the unbond, not to cancel an order', () => {
    const dot = of([at('kraken', 'staked', 'DOT', '310.5')], { kraken: cex })
    expect(dot.get('kraken:staked:DOT')?.claims[0]?.reason).toBe('staked')
    expect(RELEASES['staked']).toContain('unbond')
  })

  test('margin behind a perp is named as a perp, not as a debt to repay', () => {
    const rows = of([
      at('hyperliquid', 'collateral', 'USDC', '5000', { id: 'hyperliquid:margin:USDC' }),
      at('hyperliquid', 'perp', 'ETH', '2', { encumbers: ['hyperliquid:margin:USDC'] }),
    ])
    expect(rows.get('hyperliquid:margin:USDC')?.claims[0]?.reason).toBe('margining a perp')
  })
})

describe('nothing is said where there is nothing to say', () => {
  test('an asset entirely free reports no hold at all', () => {
    const eth = of([at('wallet', 'spot', 'ETH', '5')], { wallet: { kind: 'wallet', freeUnprovable: null } })
    expect(constrained(eth.get('wallet:spot:ETH')!)).toBe(false)
    expect(eth.get('wallet:spot:ETH')?.free?.toString()).toBe('5')
  })

  test('a book with nothing held anywhere leaves every row unconstrained', () => {
    const rows = availability([at('wallet', 'spot', 'ETH', '5'), at('wallet', 'spot', 'USDC', '10')])
    expect(rows.some(constrained)).toBe(false)
  })
})
