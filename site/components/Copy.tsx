'use client'

import { useEffect, useRef, useState } from 'react'

/** Long enough to read as an answer, short enough not to stand in the way of a second copy. */
const HELD_MS = 1600

type Outcome = 'idle' | 'done' | 'failed'

/** The word on the button, and the fuller one only the announcement carries. */
const WORDS: Record<Outcome, { face: string; spoken: string }> = {
  idle: { face: 'Copy', spoken: '' },
  done: { face: 'Copied', spoken: 'Copied' },
  failed: { face: 'Failed', spoken: 'Copy failed — select the text instead' },
}

/**
 * Copy, for the block of shell it sits in the title bar of. It takes the text
 * as a prop rather than reading it back out of the DOM, so what lands on the
 * clipboard is the string the page was built from — a command a reader pastes
 * into a shell cannot be whatever the rendering happened to leave behind.
 *
 * The clipboard can refuse: a browser withholding the permission, or a page
 * opened over plain HTTP. A button that stays on `Copy` after a click reads as
 * an unpressed button rather than as a failure, so the refusal gets its own
 * word — the text is selectable either way, and that is what `failed` says.
 */
export function Copy({ text, label }: { text: string; label: string }) {
  const [outcome, setOutcome] = useState<Outcome>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    let next: Outcome = 'done'
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      next = 'failed'
    }
    setOutcome(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOutcome('idle'), HELD_MS)
  }

  return (
    <span className="ml-auto flex flex-none items-center">
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy the ${label} command`}
        className="flex cursor-pointer items-center gap-1.5 rounded-[3px] border border-rule px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-faint transition-colors hover:border-accent-dim hover:text-accent"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-[0.85em]"
        >
          {outcome === 'done' ? (
            <path d="m20 6-11 11-5-5" />
          ) : (
            <>
              <rect x="9" y="9" width="12" height="12" rx="2.5" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </>
          )}
        </svg>
        {WORDS[outcome].face}
      </button>
      {/* Outside the button rather than in it: a button's children are
          presentational, so a live region nested inside one is not reliably
          announced, and the icon and the word are the whole of the answer. */}
      <span aria-live="polite" className="sr-only">
        {WORDS[outcome].spoken}
      </span>
    </span>
  )
}
