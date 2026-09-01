import { Ext } from '@/components/Ext'
import { Link } from '@/components/Link'
import { NAV, REPO } from '@/lib/site'

export function Footer() {
  return (
    <footer className="border-t border-rule bg-bg/85 py-8 font-mono text-[0.8rem] text-faint backdrop-blur">
      <div className="wrap flex flex-wrap items-baseline gap-5">
        {NAV.filter((n) => n.href !== '/').map(({ href, label }) => (
          <Link key={href} href={href} className="text-dim hover:text-accent">
            {label}
          </Link>
        ))}
        <Ext href={REPO} className="text-dim hover:text-accent">
          GitHub
        </Ext>
        <Ext href={`${REPO}/blob/main/LICENSE`} className="ml-auto text-dim hover:text-accent">
          MIT
        </Ext>
      </div>
    </footer>
  )
}
