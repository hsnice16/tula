'use client'

import { useEffect, useState } from 'react'
import { Link } from '@/components/Link'
import {
  CONSENT_KEY,
  type ConsentChoice,
  chooseConsent,
  inConsentRegion,
  readConsent,
} from '@/lib/consent'

/**
 * Asks before Google Analytics sets cookies, where the law wants the asking.
 * Decided after mount, since storage and the time zone are the visitor's and
 * the page is the same file for everyone. Not a dialog: nothing here is in the
 * way of reading, so it takes no focus and blocks nothing.
 *
 * The two answers look alike on purpose — a yes that is easier to reach than a
 * no is not a choice the regulators accept.
 */
export function ConsentBanner() {
  const [shown, setShown] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (readConsent() !== null || !inConsentRegion()) return
    setShown(true)
    // A frame later, so the card has a closed state to transition out of.
    const frame = requestAnimationFrame(() => setOpen(true))
    // The privacy page answering for it closes the card too.
    const answered = () => setOpen(false)
    window.addEventListener(CONSENT_KEY, answered)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener(CONSENT_KEY, answered)
    }
  }, [])

  if (!shown) return null

  const choose = (choice: ConsentChoice) => {
    chooseConsent(choice)
    setOpen(false)
  }

  return (
    <section
      aria-label="Analytics cookies"
      data-open={open || undefined}
      className="reveal fixed inset-x-4 bottom-4 z-40 rounded-[5px] border border-rule bg-panel p-4 text-[0.9rem] text-dim shadow-lift sm:right-auto sm:w-[23rem]"
    >
      <p>
        May Google Analytics set cookies to count your visit? Nothing else is tracked.{' '}
        <Link href="/privacy">Privacy</Link>
      </p>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={() => choose('granted')}
          className="btn min-h-11 flex-1 cursor-pointer"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => choose('denied')}
          className="btn min-h-11 flex-1 cursor-pointer"
        >
          Decline
        </button>
      </div>
    </section>
  )
}
