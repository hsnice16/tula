import type { ReactNode } from 'react'

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
      <div className="flex items-center gap-2 border-b border-rule bg-panel-2 px-3.5 py-2.5">
        <i className="block size-2.5 flex-none rounded-full bg-[#46403c]" />
        <i className="block size-2.5 flex-none rounded-full bg-rule" />
        <i className="block size-2.5 flex-none rounded-full bg-rule" />
        <span className="ml-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-faint">
          {title}
        </span>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** A block of shell, quoted as text. `Session` is the one that draws tula itself. */
export function Terminal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Frame title={title}>
      <pre className="overflow-x-auto px-4 pb-5 pt-4 font-mono text-[0.8rem] leading-[1.62]">
        {children}
      </pre>
    </Frame>
  )
}
