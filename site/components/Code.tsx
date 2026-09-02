import type { ReactNode } from 'react'

/**
 * A path, flag or command named inside a sentence. `Terminal` is the block form,
 * for something you would run rather than something you are being told about.
 */
export function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.86rem] text-notice">{children}</code>
}
