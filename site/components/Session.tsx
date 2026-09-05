'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { Logo } from '@/components/Logo'
import { Frame } from '@/components/Terminal'
import { VERSION } from '@/lib/site'

/**
 * src/ui/theme.ts, not the page's tokens: this frame is a picture of the binary,
 * and a terminal drawn in the site's palette would be a picture of the site.
 */
const TUI = {
  accent: '#c9a227',
  accentSoft: '#8a7220',
  notice: '#dcbc64',
  onAccent: '#1a1710',
  surface: '#2a2418',
  /** ANSI gray, which is what Ink resolves theme.muted to. */
  muted: '#808080',
} as const

/**
 * src/ui/brand.ts verbatim, for the venues the rows below actually reach — not
 * the contrast-lifted Kraken the prose on this page uses, because a mark is
 * identity rather than type and this is a picture of the gutter the binary
 * draws. Restated because the site cannot import from `src/`;
 * src/site-example.test.ts fails on a hue that has drifted and on one nothing
 * here is left to draw.
 */
const BRAND: Readonly<Record<string, string>> = {
  aave: '#9c8cff',
  binance: '#f0b90b',
  circle: '#5fbfff',
  coinbase: '#0052ff',
  hyperliquid: '#97fce4',
  kraken: '#7132f5',
  wallet: '#627eea',
}

/** The mark for a row, keyed off its leading word: `/kraken breaks` is Kraken's. */
const brandOf = (label: string) => BRAND[label.replace(/^\//, '').split(' ')[0] ?? '']

/** The row every reserved height below is a multiple of. */
const ROW = '1.3rem'
const rows = (n: number) => `calc(${n} * ${ROW})`

/**
 * A row of a list the binary draws: the command, and what it says beside it. An
 * empty label is a group heading, and an empty pair is the blank the palette
 * opens a section with — both are rows the window has to count.
 */
type Row = readonly [label: string, summary: string]

/**
 * The top-level `/` menu, grouped and alphabetical inside each group, exactly as
 * buildCommands composes it. Every venue in the build is listed whether or not
 * it is connected, because picking one from here is the whole of connecting it.
 */
const MENU: readonly Row[] = [
  ['', 'your book'],
  ['/breaks', 'What gets liquidated first, and how far away that is'],
  ['/exposure', 'Net exposure per asset, across every venue'],
  ['/positions', 'Every position, as each venue reports it'],
  ['/shock <asset> <percent>', 'Reprice everything and see what survives'],
  ['', 'venues'],
  ['/aave', '1 position · 09:14:02 (4s ago)'],
  ['/binance', 'Binance — not connected'],
  ['/circle', 'Circle Mint — not connected'],
  ['/coinbase', 'Coinbase Advanced — not connected'],
  ['/hyperliquid', '1 position · 09:14:02 (4s ago)'],
  ['/kraken', '4 balances · 09:14:02 (4s ago)'],
]

/** What the menu has below its window, which is what the binary counts there. */
const MENU_REST = 15

/**
 * The palette while nothing is typed: the same commands, plus every
 * `/<venue> <sub>` under the venue it hangs off, which is the half the `/` menu
 * only reaches two steps at a time.
 */
const BROWSE: readonly Row[] = [
  ['', 'your book'],
  ['/breaks', 'What gets liquidated first, and how far away that is'],
  ['/exposure', 'Net exposure per asset, across every venue'],
  ['/positions', 'Every position, as each venue reports it'],
  ['/shock <asset> <percent>', 'Reprice everything and see what survives'],
  ['', ''],
  ['', 'venues'],
  ['/aave', '1 position · 09:14:02 (4s ago)'],
  ['/aave connect', 'Add or replace this venue’s read-only key'],
  ['/aave positions', 'Positions held here'],
  ['/aave breaks', 'What can be liquidated here'],
  ['/aave status', 'Freshness, key scope, last error'],
]

/** Matches below the window, counted in matches rather than rows, as the dialog does. */
const BROWSE_BELOW = 60

/** Rows the whole browse list draws as — the headings and the blanks included. */
const BROWSE_ROWS = 76

/**
 * The same palette once `brea` is typed: ranked and flat, headings dropped. Four
 * venues answer to it and none of them had to be named — the reason to reach for
 * ctrl+k over `/` at all.
 */
const SEARCH: readonly Row[] = [
  ['/breaks', 'What gets liquidated first, and how far away that is'],
  ['/aave breaks', 'What can be liquidated here'],
  ['/kraken breaks', 'What can be liquidated here'],
  ['/wallet breaks', 'What can be liquidated here'],
  ['/hyperliquid breaks', 'What can be liquidated here'],
]

const SEARCH_QUERY = 'brea'

/** The list's height, held constant so typing never moves the search line above it. */
const WINDOW = 12

/** How much of the list is on screen, sized the way Scrollbar in src/ui/Palette.tsx sizes it. */
const BROWSE_THUMB = Math.max(1, Math.round((WINDOW * WINDOW) / BROWSE_ROWS))

/** The menu's window plus the row that counts what is under it. */
const MENU_ROWS = MENU.length + 1

/**
 * Rows the transcript fills with nothing open. The menu is taken out of this
 * rather than added under it, so opening one scrolls the session up a terminal's
 * worth instead of growing the page — which is the only thing a terminal can do.
 */
const BODY_ROWS = 27

interface Beat {
  /** What is on the input line. */
  input: string
  /** Which of KEYS is lit in the title bar for the whole run of this beat. */
  lit: 0 | 1 | 2
  open?: 'menu' | 'browse' | 'search' | 'expanded'
  ms: number
}

const KEYS = ['/', 'ctrl+k', 'ctrl+o'] as const

/** Nothing open. Where the loop starts, and where it stays under reduced motion. */
const REST = { input: '', lit: 0, ms: 1600 } as const satisfies Beat

/**
 * The three keys are the whole of the interface a transcript cannot show, so the
 * frame works them rather than listing them. Every state it passes through is one
 * the binary actually draws, down to the counts under each list.
 */
const SCRIPT = [
  REST,
  { input: '/', lit: 0, ms: 200 },
  { input: '/', lit: 0, open: 'menu', ms: 4200 },
  { input: '', lit: 1, ms: 700 },
  { input: '', lit: 1, open: 'browse', ms: 3800 },
  { input: '', lit: 1, open: 'search', ms: 3800 },
  { input: '', lit: 2, ms: 700 },
  { input: '', lit: 2, open: 'expanded', ms: 3000 },
] as const satisfies readonly Beat[]

/** Ink's `inverse` cursor: a block in the foreground colour, and it does not blink. */
const Cursor = ({ dim }: { dim: boolean }) => <span className={dim ? '' : 'bg-dim'}> </span>

/**
 * The session's opening record, written into the transcript rather than drawn in
 * the frame — see the banner in src/ui/app.tsx, which is why it scrolls away
 * under the menu like everything else above it.
 */
export const Banner = () => (
  <span className="flex gap-[2ch]">
    {/* Drawn, not written: a cell is a block glyph's own box, so the binary's
        three rows tile there and come apart in a line box, the way the
        palette's scrollbar below does. Sized to the columns and rows it takes
        in the terminal. */}
    <Logo
      className="w-[7ch] flex-none self-start"
      style={{ height: rows(3), color: TUI.accent }}
      preserveAspectRatio="xMidYMin meet"
    />
    <span className="min-w-0">
      <span className="block font-bold" style={{ color: TUI.accent }}>{`tula ${VERSION}`}</span>
      <span className="block text-dim">
        Your true exposure, what breaks first, and more, across every venue at once.
      </span>
      <span className="block text-dim">Connected: wallet, hyperliquid, aave, kraken</span>
    </span>
  </span>
)

/**
 * A line typed at tula's own prompt, drawn the way the transcript draws it: a
 * bar the width of the frame, so a session reads as a sequence of questions
 * rather than a wall — see TranscriptEntry in src/ui/app.tsx. The negative
 * margin is what takes it back out to the left edge while its text stays one
 * column in, with the output indented two further. It stops short of the right
 * edge because everything does: the frame keeps a column there.
 */
export const Prompt = ({ children }: { children: ReactNode }) => (
  <span
    className="-ml-[3ch] my-[1.3rem] block px-[1ch]"
    style={{ background: TUI.surface, color: TUI.accent }}
  >
    {children}
  </span>
)

/**
 * The tail of an answer the transcript is holding back, and the row that stands
 * in for it — see Output in src/ui/app.tsx. The count is read off the text so
 * the page cannot claim a number it is not holding, and the two swap in place:
 * one row either way, so ctrl+o moves nothing else in the frame.
 */
export const Held = ({ children }: { children: string }) => {
  const lines = children.split('\n').length
  return (
    <span className="relative block h-[1.3rem]">
      <span className="absolute inset-0 text-dim transition-opacity duration-300 group-data-[expanded]/tui:opacity-0">
        {`… ${lines} more line${lines === 1 ? '' : 's'} · ctrl+o`}
      </span>
      <span className="absolute inset-0 opacity-0 transition-opacity duration-300 group-data-[expanded]/tui:opacity-100">
        {children}
      </span>
    </span>
  )
}

/** The label column, padded across every row so the summaries line up under each other. */
const widthOf = (list: readonly Row[]) => Math.max(...list.map(([label]) => label.length))

/**
 * One row of either list. Only the selection is lit, and the marks: everything
 * else is uniformly dim so the eye tracks one thing, and grouping is carried by
 * the labels rather than by weight. A mark is the exception because it is
 * identity, not emphasis.
 *
 * The two lists mark the selection differently, and so does the binary: the menu
 * has the input line right above it and lifts the row to the accent under a
 * caret, while the palette floats free and needs a bar to be the only lit thing
 * in it. A brand colour laid on that bar is unreadable at best and a different
 * brand at worst, so the mark gives way to legibility for that one row.
 */
function ListRow({
  row: [label, summary],
  width,
  selected,
  bar,
}: {
  row: Row
  width: number
  selected: boolean
  bar: boolean
}) {
  if (label === '') {
    return (
      <div className="text-dim" style={{ height: ROW }}>
        {summary}
      </div>
    )
  }
  const brand = brandOf(label)
  const mark = brand && (selected && bar ? TUI.onAccent : brand)
  const lit = selected
    ? bar
      ? { background: TUI.accent, color: TUI.onAccent }
      : { color: TUI.accent }
    : {}
  return (
    <div
      className={`overflow-hidden text-ellipsis ${selected ? 'font-bold' : 'text-dim'}`}
      style={{ height: ROW, ...lit }}
    >
      {`${bar ? '' : selected ? '❯' : ' '} ${label.padEnd(width)}  `}
      <span style={mark ? { color: mark } : undefined}>{mark ? '●' : ' '}</span>
      {` ${summary}`}
    </div>
  )
}

/** Rows of the list nothing fills, so a filter never changes either list's height. */
const Padding = ({ count }: { count: number }) => (
  <div style={{ height: rows(count) }} aria-hidden="true" />
)

/**
 * Search across the whole command surface at once, floated over a copy of the
 * screen — see src/ui/Palette.tsx, which draws it over a second transcript for
 * the same reason. Centred on the transcript rather than the frame: it sits
 * above the input line and the status, it does not cover them.
 *
 * 54em is the binary's 90 columns at this stack's advance, and it is constant
 * rather than fitted to the matches: a dialog that resizes as you type walks its
 * own search line out from under the cursor. Not `ch`, which resolves against a
 * font this text is not being laid out in and comes back several columns short.
 */
function PaletteDialog({
  query,
  list,
  below,
  thumb,
}: {
  query: string
  list: readonly Row[]
  below: number
  thumb: number
}) {
  const width = widthOf(list)
  const selected = list.findIndex(([label]) => label !== '')
  return (
    <div
      className="w-full whitespace-pre rounded-[6px] border px-[2ch] py-[1.3rem] shadow-[0_18px_50px_-18px_rgba(0,0,0,0.95)]"
      style={{ borderColor: TUI.accentSoft, background: TUI.surface }}
    >
      <div className="flex" style={{ height: ROW }}>
        <span className="font-bold" style={{ color: TUI.accent }}>
          commands
        </span>
        <span className="ml-auto text-dim">esc</span>
      </div>
      <div style={{ height: ROW }} />
      <div style={{ height: ROW }}>
        {query === '' ? <span className="text-dim">{'search  '}</span> : null}
        <span style={{ color: TUI.accent }}>{query}</span>
        <Cursor dim={false} />
      </div>
      <div style={{ height: ROW }} />
      <div className="flex gap-[1ch]">
        <div className="min-w-0 flex-1">
          {list.map((row, at) => (
            <ListRow
              key={row[0] || `h${at}`}
              row={row}
              width={width}
              selected={at === selected}
              bar
            />
          ))}
          <Padding count={WINDOW - list.length} />
        </div>
        {/* Where you are in the list, which the wheel needs and the arrow keys
            never did: scrolling with no cursor to follow leaves nothing else to
            say how far down this is, or how much of it is on screen.

            Rules rather than the `│` and `┃` the binary writes. Box-drawing
            glyphs tile into an unbroken line in a terminal because the cell is
            the glyph's own box; here the line box is taller than the glyph, and
            a column of them draws as a dashed line. */}
        <div
          className="relative w-[1ch] flex-none"
          aria-hidden="true"
          style={{ height: rows(WINDOW) }}
        >
          <div
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 opacity-70"
            style={{ background: TUI.accentSoft }}
          />
          {thumb > 0 && (
            <div
              className="absolute top-0 left-1/2 w-[2px] -translate-x-1/2"
              style={{ background: TUI.accent, height: rows(thumb) }}
            />
          )}
        </div>
      </div>
      <div style={{ height: ROW }} />
      <div className="overflow-hidden text-ellipsis text-dim" style={{ height: ROW }}>
        {below > 0 ? `${below} more below · ` : ''}
        enter runs it · tab puts it on the line · esc closes
      </div>
    </div>
  )
}

/**
 * The running tool: a transcript, the line you type on, and the status line
 * under it. `status` is the same string src/ui/app.tsx composes, so it has to
 * describe the book the transcript above it came from.
 */
export function Session({ status, children }: { status: string; children: ReactNode }) {
  const [at, setAt] = useState(0)
  const beat: Beat = SCRIPT[at] ?? REST

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setTimeout(() => setAt((i) => (i + 1) % SCRIPT.length), beat.ms)
    return () => clearTimeout(timer)
  }, [beat])

  // Behind the palette the line is not taking input, and reads that way — the
  // same treatment app.tsx gives a command in flight.
  const palette = beat.open === 'browse' || beat.open === 'search'
  const menuWidth = widthOf(MENU)

  return (
    <Frame
      title="tula"
      aside={
        <span className="ml-auto flex flex-none gap-1.5 font-mono text-[0.62rem] tracking-[0.04em]">
          {KEYS.map((key, i) => (
            <span
              key={key}
              className="rounded-[3px] border px-1.5 py-0.5 transition-colors duration-500"
              style={
                i === beat.lit
                  ? { borderColor: TUI.accentSoft, color: TUI.accent, background: TUI.surface }
                  : { borderColor: 'var(--color-rule)', color: 'var(--color-faint)' }
              }
            >
              {key}
            </span>
          ))}
        </span>
      }
    >
      <div
        className="group/tui relative font-mono text-[0.8rem]"
        {...(beat.open === 'expanded' ? { 'data-expanded': '' } : {})}
        style={{ lineHeight: ROW }}
      >
        <div className={`transition-opacity duration-500 ${palette ? 'opacity-40' : ''}`}>
          {/* Wide on a narrow screen is a terminal you scroll, not one that
              reflows — but the bars and rules still have to reach its edges. */}
          <div className="overflow-x-auto">
            <div className="w-full min-w-max px-[1ch]">
              {/* Anchored to the bottom and clipped at the top, which is the
                  only direction a terminal loses a row in. */}
              <div
                className="relative overflow-hidden transition-[height] duration-300 ease-out"
                style={{ height: rows(BODY_ROWS - (beat.open === 'menu' ? MENU_ROWS : 0)) }}
              >
                <pre className="absolute inset-x-0 bottom-0 pb-[1.3rem] pl-[3ch] font-mono text-[0.8rem] leading-[1.3rem]">
                  {children}
                </pre>
              </div>

              <div
                className="whitespace-pre border-y px-[1ch] transition-colors duration-500"
                style={{ borderColor: palette ? TUI.muted : TUI.accent }}
              >
                <span style={{ color: palette ? TUI.muted : TUI.accent }}>{'❯ '}</span>
                {beat.input === '' ? (
                  <>
                    <Cursor dim={palette} />
                    <span className="text-dim">
                      {' ask anything · / for commands · ctrl+k to search them'}
                    </span>
                  </>
                ) : (
                  <>
                    {beat.input}
                    <Cursor dim={palette} />
                  </>
                )}
              </div>

              <div
                className={`overflow-hidden whitespace-pre pl-[2ch] transition-[height,opacity] duration-300 ease-out ${
                  beat.open === 'menu' ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ height: beat.open === 'menu' ? rows(MENU_ROWS) : 0 }}
              >
                {MENU.map((row, i) => (
                  <ListRow
                    key={row[0] || `h${i}`}
                    row={row}
                    width={menuWidth}
                    selected={i === 1}
                    bar={false}
                  />
                ))}
                <div className="text-dim" style={{ height: ROW }}>
                  {`  ${MENU_REST} more — keep typing to narrow it`}
                </div>
              </div>

              <div className="h-[3.2rem] whitespace-pre pb-[0.6rem] pl-[1ch]">
                <div className="overflow-hidden text-ellipsis text-dim">{status}</div>
                <div
                  className={`overflow-hidden text-ellipsis transition-opacity duration-300 ${
                    beat.open === 'expanded' ? '' : 'opacity-0'
                  }`}
                  style={{ color: TUI.notice }}
                >
                  every line is shown · ctrl+o to collapse
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 bottom-[5.2rem] flex items-center justify-center px-4 transition-opacity duration-500 ${
            palette ? '' : 'opacity-0'
          }`}
        >
          <div
            className={`w-[min(54em,100%)] transition-transform duration-500 ${palette ? '' : 'translate-y-1'}`}
          >
            {beat.open === 'search' ? (
              <PaletteDialog query={SEARCH_QUERY} list={SEARCH} below={0} thumb={0} />
            ) : (
              <PaletteDialog query="" list={BROWSE} below={BROWSE_BELOW} thumb={BROWSE_THUMB} />
            )}
          </div>
        </div>
      </div>
    </Frame>
  )
}
