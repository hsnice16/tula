import type { ReactNode } from 'react'

/**
 * A path, flag or command named inside a sentence. `Terminal` is the block form,
 * for something you would run rather than something you are being told about.
 */
export function Code({ children }: { children: ReactNode }) {
  // `break-words`: an environment variable is one unbreakable token, and at
  // 200% text zoom on a phone `TULA_REQUIRE_ATTESTATION=1` is wider than the
  // column — which pushed the whole page sideways rather than wrapping.
  return <code className="font-mono text-[0.86rem] break-words text-notice">{children}</code>
}
