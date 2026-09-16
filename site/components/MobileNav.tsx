'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Link } from '@/components/Link'
import { VersionPill } from '@/components/VersionPill'

type NavLink = { readonly href: string; readonly label: string }

/**
 * The header's links below `phone`, behind one button. A disclosure rather than
 * `role="menu"`: WAI-ARIA reserves menu for application menus that take arrow
 * keys, and a list of page links is navigation.
 */
export function MobileNav({ links, current }: { links: readonly NavLink[]; current: string }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const first = useRef<HTMLAnchorElement>(null)
  const pathname = usePathname()

  // A link that stays on a page it already shows would otherwise leave the menu
  // open over the page it was chosen for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the route change is the trigger, not a value read.
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    // Focus goes back to the button, or a keyboard reader is left on nothing.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((was) => !was)}
        // 36px drawn, 44px to a finger: the `after` extends the target past a box
        // that at full size outweighed the wordmark beside it. 5px, not 4: an
        // absolute child is placed from inside the 1px border.
        className="relative flex size-9 items-center justify-center rounded-lg border border-rule bg-panel-2 text-dim transition-colors duration-200 after:absolute after:-inset-[5px] after:content-[''] hover:text-ink"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="size-5"
        >
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {open && (
        <div
          id="mobile-nav"
          className="absolute right-0 top-full z-20 mt-2 min-w-52 overflow-hidden rounded-xl border border-rule bg-panel shadow-lift"
        >
          <nav aria-label="Primary">
            {links.map(({ href, label }, i) => (
              <Link
                key={href}
                href={href}
                ref={i === 0 ? first : undefined}
                aria-current={href === current ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={`flex min-h-11 items-center px-5 text-[0.95rem] transition-colors duration-200 hover:bg-panel-2 ${
                  href === current ? 'text-accent' : 'text-dim hover:text-ink'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex min-h-12 items-center justify-between gap-4 border-t border-rule px-5 text-[0.8rem] text-dim">
            <span>Build</span>
            <VersionPill className="inline-flex bg-panel-2" />
          </div>
        </div>
      )}
    </div>
  )
}
