import type { AnchorHTMLAttributes } from 'react'

/**
 * Every off-site link. The counterpart to `<Link>`, which is for internal
 * routes only — see AGENTS.md. `rel` is not optional with a `_blank` target:
 * without it the opened page gets a handle on this one through `window.opener`.
 */
export function Ext({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a target="_blank" rel="noreferrer" {...props}>
      {children}
      {/* No whitespace before this tag: a space here is a wrap point, and would
          let the icon fall to its own line, orphaned from the last word. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="ml-1 inline-block h-[0.72em] w-[0.72em] align-[-0.05em] opacity-60"
      >
        <path d="M7 17 17 7M8 7h9v9" />
      </svg>
    </a>
  )
}
