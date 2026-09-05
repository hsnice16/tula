'use client'

import { usePathname } from 'next/navigation'
import { Ext } from '@/components/Ext'
import { Link } from '@/components/Link'
import { Logo } from '@/components/Logo'
import { useMarker } from '@/lib/marker'
import { NAV, REPO } from '@/lib/site'

/** `trailingSlash` puts a slash on every route; the hrefs in NAV carry none. */
const route = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

/**
 * Shared so the underline below can assume every item is the same height. The
 * border colour is not in here: each item states its own, because two competing
 * border utilities on one element are settled by stylesheet order, not by which
 * was written last.
 */
const ITEM =
  'border-b py-0.5 font-mono text-[0.74rem] uppercase tracking-[0.09em] transition-colors duration-200'

export function Nav() {
  const current = route(usePathname())
  const at = NAV.findIndex(({ href }) => href === current)
  const { mark, list, item, style } = useMarker<HTMLElement, HTMLAnchorElement>(at)

  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-bg/85 backdrop-blur">
      {/* Below `phone` the wordmark takes its own line and both rows centre. A
          left end against a right end needs a row wide enough to hold both;
          wrapped, it reads as two halves that missed each other. */}
      <div className="wrap flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2 py-3 max-phone:justify-center">
        <Link
          href="/"
          className="flex items-center gap-2 font-mono text-base font-bold text-accent transition-colors duration-200 max-phone:w-full max-phone:justify-center"
        >
          <Logo className="h-[1.5em] w-[1.5em]" />
          tula
        </Link>
        <nav
          ref={list}
          className="relative ml-auto flex flex-wrap gap-x-4 gap-y-2 max-phone:ml-0 max-phone:justify-center sm:gap-x-6"
        >
          {mark && (
            <span
              aria-hidden="true"
              style={style ?? undefined}
              className={`pointer-events-none absolute border-b border-dotted border-accent-dim ${
                mark.slide
                  ? 'transition-[left,width,top] duration-300 ease-out motion-reduce:transition-none'
                  : ''
              }`}
            />
          )}
          {NAV.map(({ href, label }, i) => (
            <Link
              key={href}
              href={href}
              ref={item(i)}
              aria-current={i === at ? 'page' : undefined}
              // Until the travelling underline has been measured — the static
              // HTML, before hydration — the active item draws its own, so a
              // cold load is never a nav with nothing marked on it.
              className={`${ITEM} ${
                i === at
                  ? `text-accent ${mark ? 'border-transparent' : 'border-dotted border-accent-dim'}`
                  : 'border-transparent text-dim hover:text-ink'
              }`}
            >
              {label}
            </Link>
          ))}
          <Ext href={REPO} className={`${ITEM} border-transparent text-dim hover:text-ink`}>
            Source
          </Ext>
        </nav>
      </div>
    </header>
  )
}
