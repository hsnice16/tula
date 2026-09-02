import { Ext } from '@/components/Ext'
import { Link } from '@/components/Link'
import { NAV, REPO, SITE } from '@/lib/site'

export function Footer() {
  return (
    <footer className="border-t border-rule bg-bg/85 py-8 font-mono text-[0.8rem] text-faint backdrop-blur">
      {/* Centred when it wraps, for the reason the header is: left alone,
          `ml-auto` would hang the licence off the right of a line of its own. */}
      <div className="wrap flex flex-wrap items-baseline gap-5 max-phone:justify-center">
        {NAV.filter((n) => n.href !== '/').map(({ href, label }) => (
          <Link key={href} href={href} className="text-dim hover:text-accent">
            {label}
          </Link>
        ))}
        <Ext href={REPO} className="text-dim hover:text-accent">
          GitHub
        </Ext>
        {/* The one link an assistant's crawler can follow to the summary written
            for it. Nothing else reaches it: a project site under /tula/ cannot
            own the robots.txt at the origin root, which is where it would
            otherwise be announced. */}
        <Ext href={`${SITE}/llms.txt`} className="text-dim hover:text-accent">
          llms.txt
        </Ext>
        <Ext
          href={`${REPO}/blob/main/LICENSE`}
          className="ml-auto text-dim hover:text-accent max-phone:ml-0"
        >
          MIT
        </Ext>
      </div>
    </footer>
  )
}
