import Link from 'next/link'
import { NAV, REPO } from '@/lib/site'

export function Footer() {
  return (
    <footer className="border-t border-rule py-8 font-mono text-[0.8rem] text-faint">
      <div className="wrap flex flex-wrap items-baseline gap-5">
        {NAV.filter((n) => n.href !== '/').map(({ href, label }) => (
          <Link key={href} href={href} className="text-dim hover:text-accent">
            {label}
          </Link>
        ))}
        <a href={REPO} className="text-dim hover:text-accent">
          GitHub
        </a>
        <a href={`${REPO}/blob/main/LICENSE`} className="ml-auto text-dim hover:text-accent">
          MIT
        </a>
      </div>
    </footer>
  )
}
