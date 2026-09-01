'use client'

import { useEffect, useState } from 'react'
import { Frame } from '@/components/Terminal'

/**
 * src/ui/theme.ts, not the page's tokens: this frame is a picture of the binary,
 * for the same reason Session.tsx is.
 */
const TUI = {
  accent: '#c9a227',
  surface: '#2a2418',
} as const

/** The row every reserved height below is a multiple of. */
const ROW = '1.3rem'

/** SPINNER in src/ui/app.tsx. */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * The two states the status line is certain to pass through, in the words
 * src/ui/app.tsx gives them, with the count it would be showing by then. The
 * transcript keeps neither: the line is overwritten and then replaced by the
 * answer, so the work is visible only while it happens, which is the whole
 * reason this frame moves at all.
 *
 * Not one label per tool. The model asks for its tools in a single turn — which
 * src/agent/agent.ts encourages, by returning every result in one message — and
 * that loop calls onTool and runs each tool synchronously, so every label but
 * the last is overwritten before Ink can paint it. A frame stepping through
 * three of them would be showing a sequence no terminal renders. What is left
 * is `thinking`, set before any tool is asked for, and the label of whichever
 * tool went last, which is the one on screen when the answer starts arriving.
 *
 * The counts are what a real turn reaches, not what this loop takes: the beats
 * are short so the frame is not a wait of its own. Do not "correct" them to the
 * playback pace — that would understate how long the tool actually takes.
 */
const WORKING = [
  ['thinking', 1],
  ['ranking what breaks first', 4],
] as const

const STEP_MS = 1500

/** Where the frame rests, and the whole of it under reduced motion. */
const ANSWERED_MS = 9000

/**
 * A question asked in plain English, and tula answering it. `question` is the
 * line as typed; `children` is the answer, wrapped for the width this frame is
 * a picture of. Every figure in it is pinned by src/site-example.test.ts.
 */
export function Ask({ question, children }: { question: string; children: string }) {
  const [at, setAt] = useState(0)
  const [frame, setFrame] = useState(0)

  // Index 0 is the answer, not the first tool call: it is where the loop rests,
  // and the only state somebody who has turned motion off will ever see.
  const step = at === 0 ? null : WORKING[at - 1]

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setTimeout(
      () => setAt((i) => (i + 1) % (WORKING.length + 1)),
      step ? STEP_MS : ANSWERED_MS,
    )
    return () => clearTimeout(timer)
  }, [step])

  useEffect(() => {
    if (!step) return
    const timer = setInterval(() => setFrame((f) => f + 1), 80)
    return () => clearInterval(timer)
  }, [step])

  // The answer's own height, read off it, so the one row the spinner occupies
  // swaps in without the frame resizing around it.
  const rows = children.split('\n').length

  return (
    <Frame title="tula">
      {/* Wide on a narrow screen is a terminal you scroll, not one that
          reflows — but the prompt bar still has to reach its edges. */}
      <div className="overflow-x-auto">
        <div
          className="w-full min-w-max px-[1ch] py-[1.3rem] font-mono text-[0.8rem]"
          style={{ lineHeight: ROW }}
        >
          {/* The bar stops a column short of the frame either side, the way
              Prompt does in Session.tsx: the frame keeps that column. */}
          <span
            className="block whitespace-pre px-[1ch]"
            style={{ background: TUI.surface, color: TUI.accent }}
          >
            {`❯ ${question}`}
          </span>

          <div className="relative" style={{ height: `calc(${rows} * ${ROW})`, marginTop: ROW }}>
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 top-0 whitespace-pre pl-[3ch] transition-opacity duration-200 ${
                step ? '' : 'opacity-0'
              }`}
              style={{ color: TUI.accent }}
            >
              {step ? `${SPINNER[frame % SPINNER.length]} ${step[0]}  ·  ${step[1]}s` : ''}
            </span>
            <pre
              className={`absolute inset-0 pl-[3ch] font-mono transition-opacity duration-300 ${
                step ? 'opacity-0' : ''
              }`}
              style={{ lineHeight: ROW }}
            >
              {children}
            </pre>
          </div>
        </div>
      </div>
    </Frame>
  )
}
