import type { ReactNode } from 'react'

/**
 * Window chrome matters: it says "this is the actual output of the tool" rather
 * than "this is a code sample somebody typed into the page".
 */
export function Terminal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[5px] border border-rule bg-panel shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]">
      <div className="flex items-center gap-2 border-b border-rule bg-panel-2 px-3.5 py-2.5">
        <i className="block size-2.5 flex-none rounded-full bg-[#3d3733]" />
        <i className="block size-2.5 flex-none rounded-full bg-rule" />
        <i className="block size-2.5 flex-none rounded-full bg-rule" />
        <span className="ml-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-faint">
          {title}
        </span>
      </div>
      <pre className="overflow-x-auto px-4 pb-5 pt-4 font-mono text-[0.8rem] leading-[1.62]">
        {children}
      </pre>
    </div>
  )
}

export const Cmd = ({ children }: { children: ReactNode }) => (
  <span className="text-accent">{children}</span>
)
