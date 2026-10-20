import type { ReactNode } from 'react'

/** The few shapes a guide's prose takes besides a paragraph, styled once. */

/** Terms and what each means: the install page's "Confirm it worked" list. */
export function Terms({ items }: { items: readonly (readonly [ReactNode, ReactNode])[] }) {
  return (
    <dl className="mb-4 grid gap-x-7 gap-y-3 text-[0.9rem] sm:grid-cols-[auto_1fr]">
      {items.map(([term, body], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a term may be markup, and the list never reorders.
        <div key={i} className="contents">
          <dt className="font-semibold text-ink [&>code]:font-normal">{term}</dt>
          <dd className="text-dim">{body}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Steps taken in order, on a venue's own screens. */
export function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="mb-4 flex list-decimal flex-col gap-2 pl-5 text-dim marker:font-mono marker:text-[0.8rem] marker:text-dim">
      {children}
    </ol>
  )
}

/** Points with no order, marked as quietly as the steps are. */
export function Points({ children }: { children: ReactNode }) {
  return (
    <ul className="mb-4 flex list-['–__'] flex-col gap-2 pl-5 text-dim marker:text-dim">
      {children}
    </ul>
  )
}

/** A formula on a line of its own. In a sentence it is `Code`. */
export function Formula({ children }: { children: string }) {
  return <p className="mb-4 font-mono text-[0.86rem] break-words text-notice">{children}</p>
}
