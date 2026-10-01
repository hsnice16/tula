import { describe, expect, test } from 'bun:test'
import Decimal from 'decimal.js'
import type { Position } from '../core/position.js'
import { questions, rest, suggestQuestion as pick } from './suggest.js'

/** The question taken whole, in its own case. */
const whole = (typed: string, all: Parameters<typeof pick>[1], passed?: ReadonlySet<string>) =>
  pick(typed, all, passed)?.text ?? null

/** What the line draws after the cursor: the question's rest, past what is typed. */
const suggestQuestion = (typed: string, all: Parameters<typeof pick>[1], passed?: ReadonlySet<string>) =>
  whole(typed, all, passed)?.slice(typed.length) ?? null

const d = (v: string) => new Decimal(v)
const at = new Date()

/** The book in the screenshot this answers: XRP nearest liquidation, HYPE and AAVE under an account ratio. */
const BOOK: Position[] = [
  {
    id: 'a:perp:XRP',
    venue: 'hyperliquid',
    kind: 'perp',
    asset: 'XRP',
    quantity: d('5061'),
    delta: d('5061'),
    asOf: at,
    liquidation: { price: d('1.40') },
  },
  {
    id: 'b:spot:USDC',
    venue: 'hyperliquid',
    kind: 'spot',
    asset: 'USDC',
    quantity: d('1248213'),
    delta: d('1248213'),
    asOf: at,
    liquidation: { ratio: { name: 'Portfolio Margin Ratio', value: d('0.014'), threshold: d('0.95'), account: 'b' } },
  },
  ...(['HYPE', 'AAVE'] as const).map(
    (asset): Position => ({
      id: `b:perp:${asset}`,
      venue: 'hyperliquid',
      kind: 'perp',
      asset,
      quantity: d('100'),
      delta: d('100'),
      asOf: at,
      liquidation: { liquidatedWith: 'b' },
    }),
  ),
]
const PRICES = new Map([
  ['XRP', d('1.49')],
  ['USDC', d('1')],
  ['HYPE', d('89.5')],
  ['AAVE', d('158')],
])

describe('a question suggested from the conversation', () => {
  test('an opener with nothing asked yet is about the whole book, not the same asset every time', () => {
    const all = questions({ book: BOOK, prices: PRICES, asked: [] })
    expect(suggestQuestion("What's ", all)).toBe('closest to liquidation?')
    expect(suggestQuestion('How much ', all)).toBe('of my book can I actually move?')
    // Past the openers, the assets come in order of risk: XRP is nearest liquidation.
    expect(suggestQuestion('How close', all)).toBe(' is my XRP to liquidation?')
  })

  test('follows what this session asked about, before any ranking', () => {
    const all = questions({ book: BOOK, prices: PRICES, asked: ['/position aave', '/exposure'] })
    // AAVE is liquidated through the account and states no price of its own, so
    // its first question is not about one.
    expect(suggestQuestion("What's ", all)).toBe('my net exposure to AAVE?')
    expect(suggestQuestion('Why ', all)).toBe('is my AAVE perp liquidated with the account?')
  })

  test('an asset typed past goes last on that line', () => {
    const all = questions({ book: BOOK, prices: PRICES, asked: [] })
    expect(suggestQuestion('How close', all, new Set(['XRP']))).toBe(' is my HYPE to liquidation?')
    expect(suggestQuestion('How close', all, new Set(['XRP', 'HYPE']))).toBe(' is my AAVE to liquidation?')
    // Every asset passed, one is still offered rather than nothing.
    expect(suggestQuestion('How close', all, new Set(['XRP', 'HYPE', 'AAVE']))).not.toBeNull()
  })

  test('an asset the line names is what it is about, whatever was passed or ranked', () => {
    const all = questions({ book: BOOK, prices: PRICES, asked: [] })
    expect(suggestQuestion('What if aave', all)).toBe(' drops 20%?')
    expect(whole('Is my hype', all, new Set(['HYPE']))).toBe('Is my HYPE perp at risk?')
  })

  test('keeps the case typed, and a curly apostrophe matches a straight one', () => {
    const all = questions({ book: BOOK, prices: PRICES, asked: [] })
    // Taken, the line is the question in its own case: `hype` becomes `HYPE`.
    expect(whole("what's my hy", all)).toBe("What's my HYPE exposure?")
    expect(suggestQuestion('what’s the l', all)).toBe('iquidation price of my XRP perp?')
    expect(suggestQuestion("WHAT'S MY T", all)).toBe('otal equity?')
  })

  test('finishes the word being typed in its own case, and never rewrites what is typed', () => {
    expect(rest("what's my h", "What's my HYPE exposure?")).toBe('ype exposure?')
    expect(rest("what's my H", "What's my HYPE exposure?")).toBe('YPE exposure?')
    expect(rest('What is my btc p', 'What is my BTC PnL?')).toBe('nl?')
    // A word typed mixed, or not begun, leaves the question's case alone.
    expect(rest('What is my btc Pn', 'What is my BTC PnL?')).toBe('L?')
    expect(rest("What's ", "What's my HYPE exposure?")).toBe('my HYPE exposure?')
  })

  test('is never offered on a command, a single letter, or a second line', () => {
    const all = questions({ book: BOOK, prices: PRICES, asked: [] })
    expect(suggestQuestion('/po', all)).toBeNull()
    expect(suggestQuestion('W', all)).toBeNull()
    expect(suggestQuestion("What's\nWh", all)).toBeNull()
    expect(suggestQuestion('zzz', all)).toBeNull()
  })

  test('states no figure: a number in a suggestion is one nothing computed', () => {
    for (const { text: q } of questions({ book: BOOK, prices: PRICES, asked: [] })) {
      expect({ q, figure: /\d/.test(q.replace(/20%/g, '')) }).toEqual({ q, figure: false })
    }
  })

  test('keeps up with every character typed, whichever way the question is worded', () => {
    // The report: a suggestion that is typed past, rather than taken, stopped
    // coming. Each of these is typed one character at a time.
    const all = questions({ book: BOOK, prices: PRICES, asked: [] })
    const asked = [
      'What is my HYPE exposure?',
      "What's my hype PnL?",
      'What is the liquidation price of my XRP perp?',
      'What is my exposure across venues?',
      'How much XRP do I hold?',
      "Where's my AAVE held?",
      'Is my XRP perp at risk?',
      'What if HYPE drops 20%?',
      'Which venues hold my USDC?',
      'What breaks first?',
    ]
    for (const question of asked) {
      for (let at = 3; at < question.length; at++) {
        const typed = question.slice(0, at)
        const rest = suggestQuestion(typed, all)
        expect({ typed, suggested: rest !== null }).toEqual({ typed, suggested: true })
        // It continues what is typed, whatever the case it was typed in.
        expect(`${typed}${rest}`.toLowerCase().startsWith(typed.toLowerCase())).toBe(true)
      }
    }
  })

  test('an empty book still offers the questions about the whole of it', () => {
    expect(suggestQuestion("What's my", questions({ book: [], prices: new Map(), asked: [] }))).toBe(' total equity?')
  })
})
