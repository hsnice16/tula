import type { SVGProps } from 'react'

/**
 * The mark, and one geometry: `app/icon.svg` states the same two paths, and it
 * is repeated rather than imported because a favicon is a file the browser
 * fetches, not a shape a component can reach into.
 *
 * `currentColor` and no background, so the header's own colour reaches it and a
 * hover carries the mark with the wordmark. The favicon keeps its plate because
 * it is dropped on whatever a tab strip is painted.
 */
export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M6 15h5a5 5 0 0 1 10 0h5" />
        <path d="M6 22h20" />
      </g>
    </svg>
  )
}
