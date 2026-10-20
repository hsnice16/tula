'use client'

import { useEffect, useState } from 'react'
import { Toggle } from '@/components/Field'
import {
  type ConsentChoice as Choice,
  CONSENT_KEY,
  chooseConsent,
  readConsent,
} from '@/lib/consent'

/**
 * The privacy page's control: withdrawing has to be as easy as agreeing was,
 * and a choice made here reaches the banner and GA the same moment.
 */
export function ConsentChoice() {
  // Unknown until mount: the choice lives in the visitor's storage.
  const [choice, setChoice] = useState<Choice | null>(null)

  useEffect(() => {
    const sync = () => setChoice(readConsent())
    sync()
    window.addEventListener(CONSENT_KEY, sync)
    return () => window.removeEventListener(CONSENT_KEY, sync)
  }, [])

  return (
    <div className="max-w-[24rem]">
      <Toggle<Choice | 'unset'>
        label="Analytics cookies"
        value={choice ?? 'unset'}
        onChange={(next) => next !== 'unset' && chooseConsent(next)}
        options={[
          { value: 'granted', label: 'Allow' },
          { value: 'denied', label: 'Don’t allow' },
        ]}
      />
      <p className="mt-2 text-[0.85rem] text-dim" aria-live="polite">
        {choice === 'granted'
          ? 'Allowed. GA may set its cookies in this browser.'
          : choice === 'denied'
            ? 'Not allowed. GA sets no cookies, and any it had set are deleted.'
            : 'No choice yet. In Europe GA sets no cookies until you allow them; elsewhere it does unless you decline.'}
      </p>
    </div>
  )
}
