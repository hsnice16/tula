import { netExposure, type PriceMap } from '../core/exposure.js'
import type { Position } from '../core/position.js'
import { whatBreaksFirst } from '../core/risk.js'

/** What a question can be suggested from: the book as read, and what this session asked. */
export interface Conversation {
  book: readonly Position[]
  prices: PriceMap
  /** Lines this session sent, newest first — commands and questions alike. */
  asked: readonly string[]
}

/** Apostrophes as a keyboard types them and as a phone or an editor replaces them. */
const fold = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'")

/** Whether what is typed still continues a question, however it is cased. */
export const continues = (question: string, typed: string): boolean => fold(question).startsWith(fold(typed))

/** Whether a line names an asset: the whole symbol, or a builder-dex market's bare name. */
const names = (line: string, asset: string): boolean => {
  const words = new Set(fold(line).split(/[^a-z0-9:.]+/).filter(Boolean))
  return words.has(asset.toLowerCase()) || words.has(asset.slice(asset.indexOf(':') + 1).toLowerCase())
}

/**
 * The assets a question is most likely about, most likely first: those this
 * session already named, then what is nearest liquidation, then the largest
 * exposures. A liquidation ranked through an account ratio is about the
 * positions under it, so those are what it contributes.
 */
function focus({ book, prices, asked }: Conversation): { named: string[]; ranked: string[] } {
  const held = [...new Set(book.map((p) => p.asset))]
  const named = asked.flatMap((line) => held.filter((asset) => names(line, asset)))
  const nearest = whatBreaksFirst([...book], prices).flatMap((r) =>
    r.members?.length ? r.members.map((p) => p.asset) : [r.position.asset],
  )
  const largest = netExposure([...book], prices)
    .filter((e) => e.notional !== null)
    .sort((a, b) => b.notional!.abs().comparedTo(a.notional!.abs()))
    .map((e) => e.asset)
  return { named: [...new Set(named)], ranked: [...new Set([...named, ...nearest, ...largest, ...held])] }
}

/** One question offered, and the asset it is about where it is about one. */
export interface Question {
  text: string
  asset?: string
}

/**
 * Questions about one asset, worded the several ways somebody at 2am would
 * start them — the asset before the topic as well as after it, since the
 * suggestion can only continue what is typed, word for word. None carries a
 * figure: a number in a suggestion is a number nothing computed.
 */
function about(asset: string, book: readonly Position[]): string[] {
  const rows = book.filter((p) => p.asset === asset)
  const perp = rows.some((p) => p.kind === 'perp')
  // A liquidation price is only asked about where the venue states one.
  const priced = rows.some((p) => p.kind === 'perp' && p.liquidation?.price !== undefined)
  const callable = rows.some((p) => p.liquidation !== undefined || p.kind === 'perp')
  const withAccount = rows.some((p) => p.liquidation?.liquidatedWith !== undefined)
  return [
    ...(priced ? [`What's the liquidation price of my ${asset} perp?`, `What's my ${asset} liquidation price?`] : []),
    ...(callable ? [`How close is my ${asset} to liquidation?`] : []),
    ...(withAccount ? [`Why is my ${asset} perp liquidated with the account?`] : []),
    `What's my net exposure to ${asset}?`,
    `What's my ${asset} exposure?`,
    ...(perp ? [`What's my ${asset} PnL?`, `What's the funding on my ${asset} perp?`] : []),
    `What happens to my book if ${asset} drops 20%?`,
    `What if ${asset} drops 20%?`,
    `What if ${asset} rises 20%?`,
    `How much ${asset} do I hold?`,
    `How much of my ${asset} can I move?`,
    ...(perp ? [`How much funding have I paid on my ${asset} perp?`, `Is my ${asset} perp at risk?`] : []),
    `Where is my ${asset} held?`,
    `Which venues hold my ${asset}?`,
    `Show me my ${asset} position in full`,
  ]
}

const GENERAL = [
  "What's closest to liquidation?",
  "What's my total equity?",
  "What's my biggest exposure?",
  "What's my exposure across venues?",
  'What breaks first?',
  'What breaks first if the market drops 20%?',
  'How much of my book can I actually move?',
  'How much funding am I paying?',
  'Is anything missing from my book?',
  'Is my book complete?',
  'Which venue carries the most risk?',
  'Show me what breaks first',
]

/** The contracted and the spelled-out start of a question, both offered. */
const SPELLINGS: readonly [string, string][] = [
  ["What's ", 'What is '],
  ["Where's ", 'Where is '],
]

const spelled = (q: Question): Question[] => {
  for (const [short, long] of SPELLINGS) {
    if (q.text.startsWith(short)) return [q, { ...q, text: `${long}${q.text.slice(short.length)}` }]
    if (q.text.startsWith(long)) return [q, { ...q, text: `${short}${q.text.slice(long.length)}` }]
  }
  return [q]
}

/**
 * Every question worth offering, most relevant first. An asset this
 * conversation already named leads; otherwise the questions about the whole
 * book do, because an opener like `What's ` says nothing yet about an asset,
 * and offering the riskiest one to every opener is the same suggestion each time.
 * The assets follow in the order `focus` ranks them.
 */
export function questions(conversation: Conversation): Question[] {
  const { named, ranked } = focus(conversation)
  const askAbout = (asset: string) => about(asset, conversation.book).map((text) => ({ text, asset }))
  const general = GENERAL.map((text) => ({ text }))
  const lead = named[0]
  return [
    ...(lead ? askAbout(lead) : []),
    ...general,
    ...ranked.filter((a) => a !== lead).flatMap(askAbout),
  ].flatMap(spelled)
}

/**
 * The most relevant question that starts with what is typed, or null. Not
 * before two characters — one starts every question — and never on a command
 * line, which the `/` menu and history already complete.
 *
 * An asset the line already names is what it is about, over any ranking. An
 * asset in `passed` was offered for this line and typed past, which says it is
 * not the one wanted, so its questions go last.
 */
export function suggestQuestion(
  typed: string,
  candidates: readonly Question[],
  passed: ReadonlySet<string> = new Set(),
): Question | null {
  if (typed.startsWith('/') || typed.trim().length < 2 || typed.includes('\n')) return null
  const want = fold(typed)
  const fits = candidates.filter((q) => q.text.length > typed.length && fold(q.text).startsWith(want))
  const named = fits.find((q) => q.asset !== undefined && names(typed, q.asset))
  return named ?? fits.find((q) => q.asset === undefined || !passed.has(q.asset)) ?? fits[0] ?? null
}

/**
 * What the line draws after what is typed, and what Tab puts there. A word
 * typed in one case is finished in it — `h` gets `ype`, `H` gets `YPE` — since
 * `hYPE`, or rewriting what was typed, reads as a mistake. Otherwise, and after
 * it, the question's case.
 */
export function rest(typed: string, question: string): string {
  const after = question.slice(typed.length)
  const word = typed.match(/\S*$/)?.[0] ?? ''
  const end = after.search(/\s|$/)
  const tail = after.slice(0, end)
  const cased =
    word === word.toLowerCase() && word !== word.toUpperCase()
      ? tail.toLowerCase()
      : word === word.toUpperCase() && word !== word.toLowerCase()
        ? tail.toUpperCase()
        : tail
  return `${cased}${after.slice(end)}`
}
