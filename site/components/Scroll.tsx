'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/** Arrived at rather than cut to, unless the reader has asked for less motion. */
function toTop() {
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  })
}

/**
 * The top of the next page, arrived at rather than cut to. Internal links leave
 * the reader at the offset they clicked from — see `Link` — and this is what
 * walks them back up.
 */
export function ScrollToTop() {
  const pathname = usePathname()
  const from = useRef<string | null>(null)
  const restoring = useRef(false)

  // Back and forward are the exception: the reader is returning to a place they
  // already had, and the browser puts them there. Popstate lands before the
  // route change React sees, so a flag set here is read by the effect below.
  useEffect(() => {
    const mark = () => {
      restoring.current = true
    }
    window.addEventListener('popstate', mark)
    return () => window.removeEventListener('popstate', mark)
  }, [])

  useEffect(() => {
    const previous = from.current
    from.current = pathname
    const back = restoring.current
    restoring.current = false
    if (back || previous === null || previous === pathname) return
    toTop()
  }, [pathname])

  return null
}

/**
 * The way back up, once there is enough page behind the reader to want one.
 *
 * It rides above the footer rather than over it: the footer is the site's other
 * set of links, and the moment somebody most wants this button is the moment
 * they have reached them. So the visible height of the footer is measured and
 * the button lifted by it — neither the scroll offset nor that height is
 * something CSS can read.
 */
export function BackToTop() {
  const [show, setShow] = useState(false)
  const [lift, setLift] = useState(0)

  useEffect(() => {
    const footer = document.querySelector('footer')
    let frame = 0

    const measure = () => {
      frame = 0
      // Measured against what the page has to scroll, not a fixed screenful:
      // the install and security pages are shorter than two screens, so a
      // screenful threshold is one they can never reach and the button would
      // never appear on them at all. It shows 40% of the way down, capped at a
      // screenful so a long page does not hold it back until the footer — and
      // not at all under half a screen of scrolling, which is no journey back.
      const range = document.documentElement.scrollHeight - window.innerHeight
      const past = Math.min(window.innerHeight, range * 0.4)
      setShow(range > window.innerHeight / 2 && window.scrollY > past)

      const top = footer?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY
      setLift(Math.max(0, window.innerHeight - top))
    }

    // One measurement per painted frame: a scroll handler that reads a rect on
    // every event reads it far more often than the screen can show the result.
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    // Two elements for two transforms. The wrapper carries the lift, which is
    // recomputed every painted frame while the footer comes up and must never
    // be eased — the button would chase the scroll a fifth of a second behind.
    // The nudge under the cursor is the button's own, and is eased.
    // The wrapper takes no pointer events of its own: it is the size of the
    // button, and left clickable it would swallow every click in that corner
    // even on the pages where the button never appears.
    <div
      className="pointer-events-none fixed right-8 bottom-8 z-20"
      style={{ transform: `translateY(${-lift}px)` }}
    >
      <button
        type="button"
        onClick={toTop}
        aria-label="Back to top"
        aria-hidden={!show}
        tabIndex={show ? undefined : -1}
        className={`grid size-14 cursor-pointer place-items-center rounded-full border border-rule bg-panel/90 text-dim backdrop-blur transition duration-200 hover:-translate-y-1 hover:border-accent-dim hover:text-accent motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
          show ? 'pointer-events-auto' : 'opacity-0'
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  )
}
