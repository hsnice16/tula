'use client'

import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { useMarker } from '@/lib/marker'

export interface Channel {
  name: string
  /** Sits after the name, quieter — what the channel is, not what it does. */
  note?: string
  body: ReactNode
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/**
 * One install channel at a time. All three used to run down the page at once,
 * and every section under them branched three ways in prose — a reader on any
 * one channel read two answers that were not theirs to find the one that was.
 *
 * Panels hide rather than unmount, so the static export ships all three in the
 * HTML: what a crawler indexes and what find-in-page reaches is the whole page,
 * not whichever tab happened to be first.
 */
export function Channels({ channels }: { channels: Channel[] }) {
  const [at, setAt] = useState(0)
  /** The first panel is where the page started, not somewhere it moved to, so
      it is on screen before this is true and animates on no one's arrival. */
  const [moved, setMoved] = useState(false)
  const { mark, list, items, item, style } = useMarker<HTMLDivElement, HTMLButtonElement>(at)

  const show = (to: number) => {
    setAt(to)
    setMoved(true)
  }

  /** Arrow keys move the selection itself: the panels are already in the page,
      so a separate "focus, then press Enter" step would be ceremony over
      nothing to load. */
  const steer = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? channels.length - 1
          : step
            ? (at + step + channels.length) % channels.length
            : -1
    if (to < 0) return
    event.preventDefault()
    show(to)
    items.current[to]?.focus()
  }

  return (
    <div>
      <div
        ref={list}
        role="tablist"
        aria-label="Install channels"
        onKeyDown={steer}
        className="relative flex flex-wrap gap-x-7 border-b border-rule"
      >
        {/* The nav's travelling underline, drawn solid rather than dotted: the
            two rows would otherwise read as one site nav that had somehow got
            onto the page twice. The buttons' own `-mb-px` shortens the flex line
            by the rule's width, which is what lands this on the rule rather than
            a pixel above it. */}
        {mark && (
          <span
            aria-hidden="true"
            style={style ?? undefined}
            className={`pointer-events-none absolute border-b border-accent ${
              mark.slide
                ? 'transition-[left,width,top] duration-300 ease-out motion-reduce:transition-none'
                : ''
            }`}
          />
        )}
        {channels.map(({ name, note }, i) => (
          <button
            key={name}
            ref={item(i)}
            type="button"
            role="tab"
            id={`tab-${slug(name)}`}
            aria-selected={i === at}
            aria-controls={`panel-${slug(name)}`}
            tabIndex={i === at ? 0 : -1}
            // Until the travelling underline has been measured — the static
            // HTML, before hydration — the selected tab draws its own, so a cold
            // load is never a strip with nothing marked on it.
            className={`-mb-px cursor-pointer whitespace-nowrap border-b py-3 font-mono text-[0.74rem] uppercase tracking-[0.09em] transition-colors duration-200 ${
              i === at
                ? `text-accent ${mark ? 'border-transparent' : 'border-accent'}`
                : 'border-transparent text-dim hover:text-ink'
            }`}
            onClick={() => show(i)}
          >
            {name}
            {note && <span className="ml-1.5 text-faint">{note}</span>}
          </button>
        ))}
      </div>
      {channels.map(({ name, body }, i) => (
        <div
          key={name}
          role="tabpanel"
          id={`panel-${slug(name)}`}
          aria-labelledby={`tab-${slug(name)}`}
          hidden={i !== at}
          className={`max-w-[46rem] pt-10 ${moved ? 'animate-panel' : ''}`}
        >
          {body}
        </div>
      ))}
    </div>
  )
}
