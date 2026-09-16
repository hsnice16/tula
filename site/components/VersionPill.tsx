import { VERSION } from '@/lib/site'

/** A hyphen marks a pre-release, the same rule `src/version.ts` applies to the binary. */
const PRE_RELEASE = VERSION.includes('-')

/**
 * The release the site describes, so a reader can tell which build a page is
 * about. The caller sets the display: two utilities that both set `display`
 * resolve by stylesheet order, not by which was written last.
 */
export function VersionPill({ className }: { className: string }) {
  return (
    <span
      role="img"
      aria-label={PRE_RELEASE ? `Version ${VERSION}, pre-release` : `Version ${VERSION}`}
      className={`items-center rounded-full border border-rule px-2.5 py-0.5 font-mono text-[0.75rem] tabular-nums text-dim ${className}`}
    >
      v{VERSION}
      {PRE_RELEASE && <span className="ml-1.5 text-notice">pre-release</span>}
    </span>
  )
}
