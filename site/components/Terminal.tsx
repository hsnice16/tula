import type { ReactNode } from 'react'
import { Copy } from '@/components/Copy'

/**
 * Window chrome matters: it says "this is the actual output of the tool" rather
 * than "this is a code sample somebody typed into the page".
 */
export function Frame({
  title,
  aside,
  children,
}: {
  title: string
  /** Sits at the right of the title bar, after the name. */
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[5px] border border-rule bg-panel shadow-lift">
      {/* Wraps so that enlarged text drops the aside to its own row rather than
          pushing it past the frame's clipped edge. The title's zero basis is what
          makes the aside, not the title, the item that wraps. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-panel-2 px-3.5 py-2.5">
        <i className="block size-2.5 flex-none rounded-full bg-[#46403c]" />
        <i className="block size-2.5 flex-none rounded-full bg-rule" />
        <i className="block size-2.5 flex-none rounded-full bg-rule" />
        <span className="ml-2 flex-1 font-mono text-[0.75rem] leading-[1.125rem] uppercase tracking-[0.12em] text-dim">
          {title}
        </span>
        {aside}
      </div>
      {children}
    </div>
  )
}

/**
 * A block of shell, quoted as text. `Session` is the one that draws tula itself.
 *
 * `children` is a string rather than a `ReactNode` so the copy button can be
 * handed the same value the block renders. Anything richer would put the text
 * on the clipboard and the markup on the page, and the two would drift.
 */
export function Terminal({ title, children }: { title: string; children: string }) {
  return (
    <Frame title={title} aside={<Copy text={children} label={title} />}>
      <pre className="overflow-x-auto px-4 pb-5 pt-4 font-mono text-[0.8rem] leading-[1.62]">
        {children}
      </pre>
    </Frame>
  )
}

/**
 * One line you would paste, in a plain box. The third size, between `Code` in a
 * sentence and `Terminal`: window chrome says "this is the tool talking", and
 * around a single `rm` it is furniture standing where the command should be.
 */
export function Command({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex items-center gap-4 rounded-[5px] border border-rule bg-panel py-3 pl-4 pr-3">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[0.8rem] text-ink">
        {children}
      </code>
      <Copy text={children} label={label} />
    </div>
  )
}
