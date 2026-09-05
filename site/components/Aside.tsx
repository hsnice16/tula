import type { ReactNode } from 'react'

/**
 * A fact about the block above it: how updates arrive on this channel, what this
 * channel cannot prove. `warn` is for the second kind — something the reader
 * would otherwise assume they had and do not.
 *
 * Short by design. A paragraph in here is a paragraph in the wrong place: this
 * has to be readable without deciding to read it.
 */
export function Aside({ warn, children }: { warn?: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex gap-3 rounded-[5px] border bg-panel px-4 py-3.5 ${
        warn ? 'border-accent-dim' : 'border-rule'
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`mt-px size-[1.05em] flex-none ${warn ? 'text-notice' : 'text-faint'}`}
      >
        {warn ? (
          <>
            <path d="M10.3 3.9 2.3 17.9A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="9.25" />
            <path d="M12 16.5v-5" />
            <path d="M12 7.75h.01" />
          </>
        )}
      </svg>
      <p className="text-[0.9rem] leading-relaxed text-dim">{children}</p>
    </div>
  )
}
