'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { Frame } from '@/components/Terminal'

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

/** The row every reserved height below is a multiple of. */
const ROW = '1.3rem'

interface Beat {
  /** What is on the input line. */
  input: string
  /** Which of KEYS is lit in the title bar for the whole run of this beat. */
  lit: 0 | 1 | 2
  open?: 'menu' | 'palette' | 'expanded'
  ms: number
}

const KEYS = ['/', 'ctrl+k', 'ctrl+o'] as const

/** Nothing open. Where the loop starts, and where it stays under reduced motion. */
const REST = { input: '', lit: 0, ms: 1200 } as const satisfies Beat

/**
 * The three keys are the whole of the interface a transcript cannot show, so
 * the frame works them rather than listing them. Every state it passes through
 * is one the binary actually draws — `/s` matches exactly one command, and
 * ctrl+o with nothing held back says so rather than expanding anything.
 */
const SCRIPT = [
  REST,
  { input: '/', lit: 0, ms: 170 },
  { input: '/s', lit: 0, open: 'menu', ms: 2900 },
  { input: '/', lit: 0, ms: 150 },
  { input: '', lit: 1, ms: 850 },
  { input: '', lit: 1, open: 'palette', ms: 3600 },
  { input: '', lit: 2, ms: 850 },
  { input: '', lit: 2, open: 'expanded', ms: 3000 },
] as const satisfies readonly Beat[]

/** Ink's `inverse` cursor: a block in the foreground colour, and it does not blink. */
const Cursor = ({ dim }: { dim: boolean }) => <span className={dim ? '' : 'bg-dim'}> </span>

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
    className="-ml-[3ch] my-[1.3rem] block px-[1ch] first:mt-0"
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
  const inert = beat.open === 'palette'

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
        <div className={`transition-opacity duration-500 ${inert ? 'opacity-40' : ''}`}>
          {/* Wide on a narrow screen is a terminal you scroll, not one that
              reflows — but the bars and rules still have to reach its edges. */}
          <div className="overflow-x-auto">
            <div className="w-full min-w-max px-[1ch]">
              {/* The headroom the menu below spends. The two heights always sum
                  to the same thing, so opening the menu slides the transcript up
                  a terminal's worth rather than growing the page. */}
              <div
                className={`transition-[height] duration-300 ease-out ${
                  beat.open === 'menu' ? 'h-0' : 'h-[2.6rem]'
                }`}
              />
              <pre className="pb-[1.3rem] pl-[3ch] font-mono text-[0.8rem] leading-[1.3rem]">
                {children}
              </pre>

              <div
                className="whitespace-pre border-y px-[1ch] transition-colors duration-500"
                style={{ borderColor: inert ? TUI.muted : TUI.accent }}
              >
                <span style={{ color: inert ? TUI.muted : TUI.accent }}>{'❯ '}</span>
                {beat.input === '' ? (
                  <>
                    <Cursor dim={inert} />
                    <span className="text-dim">
                      {' ask anything · / for commands · ctrl+k to search them'}
                    </span>
                  </>
                ) : (
                  <>
                    {beat.input}
                    <Cursor dim={inert} />
                  </>
                )}
              </div>

              <div
                className={`overflow-hidden whitespace-pre pl-[2ch] transition-[height,opacity] duration-300 ease-out ${
                  beat.open === 'menu' ? 'h-[2.6rem]' : 'h-0 opacity-0'
                }`}
              >
                <div className="text-dim">your book</div>
                <div
                  className="overflow-hidden text-ellipsis font-bold"
                  style={{ color: TUI.accent }}
                >
                  {'❯ /shock <asset> <percent>  Reprice everything and see what survives'}
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

        {/* Centred over the transcript rather than the whole frame: the dialog
            floats above the input line and the status, it does not cover them. */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 bottom-[5.2rem] flex items-center justify-center px-4 transition-opacity duration-500 ${
            beat.open === 'palette' ? '' : 'opacity-0'
          }`}
        >
          <div
            className={`w-[min(42rem,100%)] whitespace-pre rounded-[6px] border px-[2ch] py-[1.3rem] shadow-[0_18px_50px_-18px_rgba(0,0,0,0.95)] transition-transform duration-500 ${
              beat.open === 'palette' ? '' : 'translate-y-1'
            }`}
            style={{ borderColor: TUI.accentSoft, background: TUI.surface }}
          >
            <div className="flex">
              <span className="font-bold" style={{ color: TUI.accent }}>
                commands
              </span>
              <span className="ml-auto text-dim">esc</span>
            </div>
            <div className="h-[1.3rem]" />
            <div>
              <span style={{ color: TUI.accent }}>shock</span>
              <Cursor dim={false} />
            </div>
            <div className="h-[1.3rem]" />
            {/* The selection is a bar, not a caret: at a glance it is the only lit thing. */}
            <div
              className="overflow-hidden text-ellipsis font-bold"
              style={{ background: TUI.accent, color: TUI.onAccent }}
            >
              {' /shock <asset> <percent>  Reprice everything and see what survives'}
            </div>
            <div className="h-[1.3rem]" />
            <div className="overflow-hidden text-ellipsis text-dim">
              {'enter puts it on the line — <asset> <percent> still has to be typed · esc closes'}
            </div>
          </div>
        </div>
      </div>
    </Frame>
  )
}
