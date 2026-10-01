import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import { findPositions, matchPositions, positionDetail, positionWords } from './detail.js'
import type { Position } from './position.js'

const d = (v: string) => new Decimal(v)
const NOW = new Date('2026-09-30T12:00:00Z')

const row = (id: string, extra: Partial<Position> & Pick<Position, 'venue' | 'kind' | 'asset'>): Position => ({
  id,
  quantity: d('1'),
  delta: d('1'),
  asOf: NOW,
  ...extra,
})

const hlPerp = row('hl:perp:BTC', {
  venue: 'hyperliquid',
  kind: 'perp',
  asset: 'BTC',
  quantity: d('-2'),
  delta: d('-2'),
  equity: d('0'),
  liquidation: { price: d('90000'), leverage: d('20'), mark: d('80000') },
  encumbers: ['hl:perps:USDC'],
  figures: {
    entry: d('82000'),
    unrealisedPnl: d('4000'),
    returnOnEquity: d('0.4878'),
    funding: { sinceOpen: d('-150.5'), allTime: d('20') },
    margin: d('8000'),
    marginMode: 'cross',
  },
})

const BOOK: Position[] = [
  hlPerp,
  row('hlxyz:perp:xyz:GOLD', { venue: 'hyperliquid-xyz', kind: 'perp', asset: 'xyz:GOLD', liquidation: { mark: d('2400') } }),
  row('cex:spot:BTC', { venue: 'cex', kind: 'spot', asset: 'BTC', quantity: d('0.5'), delta: d('0.5') }),
  row('w1:spot:ETH', { venue: 'wallet', kind: 'spot', asset: 'ETH', account: { id: 'a', label: 'cold (0xaaa)' } }),
  row('w2:spot:ETH', { venue: 'wallet', kind: 'spot', asset: 'ETH', account: { id: 'b', label: 'hot (0xbbb)' } }),
  row('bn:perp:ETHUSDT_250926', { venue: 'binance', kind: 'perp', asset: 'ETH', product: 'ETHUSDT_250926' }),
  row('bn:perp:ETHUSDT', { venue: 'binance', kind: 'perp', asset: 'ETH', product: 'ETHUSDT' }),
]

describe('words that name a position', () => {
  test('the asset alone names a row held once, whatever its case', () => {
    expect(findPositions(BOOK, ['gold']).map((p) => p.id)).toEqual(['hlxyz:perp:xyz:GOLD'])
    expect(findPositions(BOOK, ['xyz:GOLD']).map((p) => p.id)).toEqual(['hlxyz:perp:xyz:GOLD'])
  })

  test('a venue narrows to its own labels, sub-accounts and builder dexes included', () => {
    expect(findPositions(BOOK, ['gold', 'hyperliquid'])).toHaveLength(1)
    expect(findPositions(BOOK, ['btc', 'hyperliquid']).map((p) => p.id)).toEqual(['hl:perp:BTC'])
    expect(findPositions(BOOK, ['btc', 'spot']).map((p) => p.id)).toEqual(['cex:spot:BTC'])
  })

  test('an account answers to its name or its address', () => {
    expect(findPositions(BOOK, ['eth', 'cold']).map((p) => p.id)).toEqual(['w1:spot:ETH'])
    expect(findPositions(BOOK, ['eth', '0xbbb']).map((p) => p.id)).toEqual(['w2:spot:ETH'])
  })

  test('every row gets words that name it alone, and nothing else', () => {
    for (const p of BOOK) {
      const words = positionWords(p, BOOK)
      expect({ id: p.id, found: findPositions(BOOK, words).map((f) => f.id) }).toEqual({ id: p.id, found: [p.id] })
    }
    // Only as many as it takes.
    expect(positionWords(BOOK[1]!, BOOK)).toEqual(['xyz:GOLD'])
    expect(positionWords(BOOK[0]!, BOOK)).toEqual(['BTC', 'hyperliquid'])
  })

  test('an asset is read before a venue that starts the same way', () => {
    // "hype" is the start of "hyperliquid": every row there matched, HYPE among them.
    const book = [
      row('h1', { venue: 'hyperliquid', kind: 'perp', asset: 'HYPE' }),
      row('h2', { venue: 'hyperliquid', kind: 'perp', asset: 'AAVE' }),
      row('h3', { venue: 'hyperliquid', kind: 'spot', asset: 'HYPE' }),
    ]
    expect(matchPositions(book, 'hype').map((p) => p.id)).toEqual(['h1', 'h3'])
    expect(matchPositions(book, 'hype spot').map((p) => p.id)).toEqual(['h3'])
    // A word that starts no asset still reaches the venue.
    expect(matchPositions(book, 'hyperl').map((p) => p.id)).toEqual(['h1', 'h2', 'h3'])
  })

  test('the picker filter takes the start of any word, so "eth hot" is one row', () => {
    expect(matchPositions(BOOK, 'eth')).toHaveLength(4)
    expect(matchPositions(BOOK, 'eth hot').map((p) => p.id)).toEqual(['w2:spot:ETH'])
    expect(matchPositions(BOOK, 'hyp')).toHaveLength(2)
    expect(matchPositions(BOOK, '')).toHaveLength(BOOK.length)
  })
})

const detail = (p: Position, book: Position[] = [p], prices = new Map<string, Decimal>()) =>
  positionDetail(p, { book, prices, now: NOW })
const rowsOf = (p: Position, book?: Position[]) => detail(p, book).sections.flatMap((s) => s.rows)
const value = (p: Position, label: string, book?: Position[]) => rowsOf(p, book).find((r) => r.label === label)?.value
const labels = (p: Position, book?: Position[]) => rowsOf(p, book).map((r) => r.label)
const sections = (p: Position, book?: Position[]) => detail(p, book).sections.map((s) => s.title)

describe('one position in full', () => {
  test('a perp reads in the Position, PnL, Liquidation and Source sections, in that order', () => {
    expect(detail(hlPerp).sections.map((s) => [s.title, s.rows.map((r) => r.label)])).toEqual([
      ['Position', ['Size', 'Value', 'Entry Price', 'Mark Price']],
      ['PnL', ['Unrealised PnL', 'Funding']],
      ['Liquidation', ['Liq. Price', 'Margin']],
      ['Source', ['Venue', 'As Of']],
    ])
  })

  test('every figure is rendered as every table renders it', () => {
    expect(value(hlPerp, 'Size')).toBe('-2 short')
    expect(value(hlPerp, 'Value')).toBe('$160,000.00')
    expect(value(hlPerp, 'Entry Price')).toBe('$82,000.00')
    expect(value(hlPerp, 'Mark Price')).toBe('$80,000.00')
    expect(value(hlPerp, 'Unrealised PnL')).toBe('+$4,000.00 (ROE +48.8%)')
    expect(value(hlPerp, 'Liq. Price')).toBe('$90,000.00 (+12.5% to liquidation)')
    expect(value(hlPerp, 'Margin')).toBe('$8,000.00 (20x cross)')
    expect(value(hlPerp, 'As Of')).toContain('(0s ago)')
  })

  test('funding says paid or received in words, since the sign is read differently in different places', () => {
    expect(value(hlPerp, 'Funding')).toBe('$150.50 received since open · $20.00 paid all time')
  })

  test('a figure the venue did not state is not stated, never zero', () => {
    const bare = row('p', { venue: 'v', kind: 'perp', asset: 'SOL' })
    for (const label of ['Entry Price', 'Unrealised PnL', 'Liq. Price', 'Funding']) {
      expect({ label, value: value(bare, label) }).toEqual({ label, value: 'not stated by the venue' })
    }
    expect(value(bare, 'Value')).toBe('no price')
  })

  test('without the venue’s mark the price is the source’s, and said to be', () => {
    const bare = row('p', { venue: 'v', kind: 'perp', asset: 'SOL', quantity: d('3'), delta: d('3') })
    const shown = detail(bare, [bare], new Map([['SOL', d('150')]]))
    const shownRows = shown.sections.flatMap((s) => s.rows)
    expect(shownRows.find((r) => r.label === 'Price')?.value).toBe('$150.00')
    expect(shownRows.find((r) => r.label === 'Mark Price')).toBeUndefined()
    expect(shown.notes.join(' ')).toContain('Value and price are the price source’s, not the venue’s mark')
  })

  test('a per-thousand market’s entry and mark are per unit, and read in the same unit', () => {
    const pepe = row('p', {
      venue: 'hyperliquid',
      kind: 'perp',
      asset: 'PEPE',
      heldAs: 'kPEPE',
      quantity: d('1000000'),
      delta: d('1000000'),
      liquidation: { mark: d('0.000011') },
      figures: { entry: d('0.00001') },
    })
    expect(value(pepe, 'Entry Price')).toBe('$0.00001')
    expect(value(pepe, 'Mark Price')).toBe('$0.000011')
  })

  test('a figure stated in euros is printed in euros', () => {
    const eur = row('k', {
      venue: 'kraken-margin',
      kind: 'collateral',
      asset: 'BTC',
      liquidation: { leverage: d('5') },
      figures: { unrealisedPnl: d('-300'), margin: d('9200'), currency: 'EUR' },
    })
    expect(value(eur, 'Unrealised PnL')).toBe('-300 EUR')
    expect(value(eur, 'Margin')).toBe('9200 EUR (5x)')
    expect(detail(eur).notes.join(' ')).toContain('liquidates the account, not the position')
  })

  test('a debt is worth what is owed, so its value is negative', () => {
    const debt = row('d', { venue: 'aave', kind: 'debt', asset: 'USDC', quantity: d('-18000'), delta: d('-18000') })
    expect(detail(debt, [debt], new Map([['USDC', d('1')]])).sections[0]!.rows.find((r) => r.label === 'Value')?.value).toBe('-$18,000.00')
  })

  test('a margin position’s two legs are paired, not each backing the other', () => {
    const asset = row('a', { venue: 'kraken-margin', kind: 'collateral', asset: 'BTC', encumbers: ['l'] })
    const loan = row('l', { venue: 'kraken-margin', kind: 'debt', asset: 'EUR', encumbers: ['a'] })
    expect(value(asset, 'Paired With', [asset, loan])).toBe('debt EUR')
    expect(labels(asset, [asset, loan])).not.toContain('Backs')
    expect(labels(asset, [asset, loan])).not.toContain('Backed By')
  })

  test('a leverage the venue stated without a margin is its own row, not an unstated margin', () => {
    const book = row('k', { venue: 'kraken-margin', kind: 'collateral', asset: 'BTC', liquidation: { leverage: d('5') } })
    expect(value(book, 'Leverage')).toBe('5x')
    expect(labels(book)).not.toContain('Margin')
  })

  test('a spot balance has no PnL or liquidation section: it has neither to state', () => {
    expect(sections(BOOK[2]!)).toEqual(['Position', 'Source'])
    expect(labels(BOOK[2]!)).not.toContain('Entry Price')
  })

  test('a balance that margins a perp has no liquidation price of its own, and names what it backs', () => {
    const pool = row('hl:perps:USDC', { venue: 'hyperliquid', kind: 'collateral', asset: 'USDC', quantity: d('749.58'), delta: d('749.58') })
    const book = [pool, hlPerp, { ...hlPerp, id: 'hl:perp:ETH', asset: 'ETH' }]
    expect(labels(pool, book)).not.toContain('Liq. Price')
    expect(sections(pool, book)).not.toContain('Liquidation')
    expect(value(pool, 'Backs', book)).toBe('perp BTC, perp ETH')
    expect(value(hlPerp, 'Backed By', [pool, hlPerp])).toBe('collateral USDC')
  })

  test('where a venue cannot prove what is free, it says so rather than a figure', () => {
    const pool = row('x', { venue: 'hyperliquid', kind: 'spot', asset: 'USDC' })
    const shown = positionDetail(pool, {
      book: [pool],
      prices: new Map(),
      now: NOW,
      availability: { position: pool, free: null, claims: [], unprovable: 'the venue holds part of it unexplained' },
    })
    expect(shown.sections.flatMap((s) => s.rows).find((r) => r.label === 'Free')?.value).toBe(
      'unknown — the venue holds part of it unexplained',
    )
  })

  test('where it came from is the last section, and a venue’s own names are marked as its text', () => {
    const wallet = row('w', { venue: 'wallet', kind: 'spot', asset: 'ETH', heldAs: 'WETH', chain: 'base', product: 'Vault' })
    const source = detail(wallet).sections.at(-1)!
    expect(source.title).toBe('Source')
    expect(source.rows.map((r) => [r.label, Boolean(r.outside)])).toEqual([
      ['Venue', true],
      ['Chain', false],
      ['Product', true],
      ['Held As', true],
      ['As Of', false],
    ])
  })
})

describe('what liquidates it', () => {
  test('under an account ratio, the ratio is the trigger and the position’s own price is said to lie past it', () => {
    const account = row('hl:spot:USDC', {
      venue: 'hyperliquid',
      kind: 'spot',
      asset: 'USDC',
      liquidation: { ratio: { name: 'Unified Account Ratio', value: d('0.5'), threshold: d('0.95'), account: 'hl' } },
    })
    const member = { ...hlPerp, liquidation: { ...hlPerp.liquidation, liquidatedWith: 'hl' } }
    const book = [account, member]
    expect(value(member, 'Liq. Price', book)).toBe('$90,000.00')
    // The account's backing falls, not this asset's price: said so rather than as a move.
    expect(value(member, 'Unified Account Ratio', book)).toBe('50.00%, liquidated past 95.00% (what backs it can fall 47.4% first)')
    expect(detail(member, book).notes.join(' ')).toContain('lies past the account’s trigger')
    expect(detail(member, book).sections.find((s) => s.title === 'Liquidation')?.rows.map((r) => r.label)).toEqual([
      'Liq. Price',
      'Margin',
      'Unified Account Ratio',
    ])
  })

  test('an Aave leg is its market’s health factor, and the market is what goes', () => {
    const leg = row('a', {
      venue: 'aave',
      kind: 'collateral',
      asset: 'ETH',
      liquidation: { healthFactor: d('1.25'), liquidationThreshold: d('0.83') },
    })
    expect(value(leg, 'Health Factor')).toBe('1.25 (collateral can fall 20.0% first)')
    expect(value(leg, 'Liq. Threshold')).toBe('83.00%')
    expect(sections(leg)).toEqual(['Position', 'Liquidation', 'Source'])
    expect(value(leg, 'Liq. Price')).toBeUndefined()
    expect(detail(leg).notes.join(' ')).toContain('liquidated as a whole')
  })

  test('a position already past its trigger says so, not a small move', () => {
    const past = { ...hlPerp, liquidation: { ...hlPerp.liquidation, mark: d('95000') } }
    expect(value(past, 'Liq. Price')).toBe('$90,000.00 (liquidatable now)')
  })

  test('cross margin says the price moves with the rest of the account', () => {
    expect(detail(hlPerp).notes.join(' ')).toContain('Cross margin')
  })
})
