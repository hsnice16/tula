import Link from 'next/link'
import { NAV, REPO } from '@/lib/site'

export function Nav({ current }: { current: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-bg/85 backdrop-blur">
      <div className="wrap flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2 py-3">
        <Link href="/" className="font-mono text-base font-bold text-accent">
          tula
        </Link>
        <nav className="ml-auto flex flex-wrap gap-6">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={href === current ? 'page' : undefined}
              className={`border-b py-0.5 font-mono text-[0.74rem] uppercase tracking-[0.09em] ${
                href === current
                  ? 'border-accent-dim text-accent'
                  : 'border-transparent text-dim hover:text-ink'
              }`}
            >
              {label}
            </Link>
          ))}
          <a
            href={REPO}
            className="border-b border-transparent py-0.5 font-mono text-[0.74rem] uppercase tracking-[0.09em] text-dim hover:text-ink"
          >
            Source
          </a>
        </nav>
      </div>
    </header>
  )
}
