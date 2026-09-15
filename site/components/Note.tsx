'use client'

import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'

/** How far the card drifts, in px, at the ends of the term — about 2.4rem. */
const DRIFT = 38

/** Clear of the viewport edge, for a term sitting in the page's left gutter. */
const MARGIN = 16

/**
 * A term on the page carrying a caveat too long to sit beside it. It opens
 * upward: below the eyebrow is the headline, and a card that lands on it hides
 * the thing the reader came for.
 *
 * The lean is the whole reason this is a client component — pointer position is
 * not something CSS can read. It is written straight to a custom property
 * rather than through state, because a re-render per mouse move to nudge one
 * transform is a frame budget spent on nothing.
 *
 * The card is centred on the term rather than on the line it sits in, which for
 * a term in the page's left gutter puts half of it off the page — so the offset
 * is measured and clamped here rather than left to `left-1/2`.
 *
 * It outranks the sticky header, which on a phone is two rows deep and reaches
 * to within a card's height of the eyebrow this one hangs off.
 */
export function Note({ term, children }: { term: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const card = useRef<HTMLSpanElement>(null)
  const root = useRef<HTMLSpanElement>(null)
  /**
   * Read at the start of a press, not at its click: Android focuses the button
   * on the same tap, so by the click the card is already open and a toggle
   * would shut it again.
   */
  const press = useRef<{ mouse: boolean; wasOpen: boolean } | null>(null)
  const id = `${term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-note`

  // A tapped card has no hover to leave and, on iOS, no focus to lose.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', dismiss)
    }
  }, [open])

  const place = (anchor: HTMLElement, across: number) => {
    const on = card.current
    if (!on) return
    const box = anchor.getBoundingClientRect()
    const centred = box.left + box.width / 2 - on.offsetWidth / 2 + across * DRIFT
    const shift =
      Math.min(Math.max(centred, MARGIN), window.innerWidth - on.offsetWidth - MARGIN) - box.left
    on.style.setProperty('--at', across.toFixed(3))
    on.style.setProperty('--shift', `${Math.round(shift)}px`)
  }

  const track = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const across = (event.clientX - box.left) / box.width - 0.5
    place(event.currentTarget, Math.min(0.5, Math.max(-0.5, across)))
  }

  return (
    <span ref={root} className="relative inline-block">
      {/* Hover is mouse-only: iOS Safari focuses nothing on a tap and emulates
          mouseenter instead, which opened the card with nothing to close it.
          A touch press toggles through the click. */}
      <button
        type="button"
        aria-describedby={id}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'mouse') return
          track(event)
          setOpen(true)
        }}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse') track(event)
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setOpen(false)
        }}
        onPointerDown={(event) => {
          press.current = { mouse: event.pointerType === 'mouse', wasOpen: open }
        }}
        onClick={(event) => {
          const began = press.current
          press.current = null
          if (began?.mouse) return
          place(event.currentTarget, 0)
          setOpen(!(began ? began.wasOpen : open))
        }}
        onFocus={(event) => {
          place(event.currentTarget, 0)
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        // Form controls do not inherit text-transform, and this one sits in a line
        // the page sets in capitals.
        className="relative cursor-help border-b border-dashed after:absolute after:inset-x-0 after:-inset-y-[10px] after:content-[''] border-accent-dim pb-0.5 uppercase tracking-[inherit] transition-colors hover:border-accent hover:text-notice"
      >
        {term}
      </button>
      <span
        ref={card}
        id={id}
        role="tooltip"
        style={{
          transform: 'translateX(var(--shift, 0px)) rotate(calc(var(--at, 0) * 7deg))',
          transformOrigin: 'bottom center',
        }}
        className={`pointer-events-none absolute bottom-full left-0 z-20 mb-3 w-max max-w-[calc(100vw-2.5rem)] rounded border border-rule bg-panel px-3.5 py-2.5 font-sans text-[0.9rem] font-normal normal-case leading-relaxed tracking-normal text-dim shadow-[0_18px_40px_-16px_rgba(0,0,0,0.9)] transition-[opacity,transform] duration-200 ease-out ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* The pop is a keyframe on its own element: it animates the same
            property the lean does, and one would otherwise cancel the other. */}
        <span className={`block ${open ? 'animate-pop' : ''}`}>{children}</span>
      </span>
    </span>
  )
}
