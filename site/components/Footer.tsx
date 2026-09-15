import { Ext } from '@/components/Ext'
import { Link } from '@/components/Link'
import { NAV, REPO, SITE } from '@/lib/site'

/**
 * The `after` takes a 29px link to a 44px target without moving it. The rows
 * are gap-y-4 apart so that, wrapped on a phone, one row's targets do not
 * overlap the next and hand it their taps.
 */
const LINK =
  "relative py-1 text-dim hover:text-accent after:absolute after:-inset-x-[7px] after:-inset-y-[7.5px] after:content-['']"

export function Footer() {
  return (
    <footer className="border-t border-rule bg-bg/85 py-8 font-mono text-[0.8rem] text-dim backdrop-blur">
      {/* Centred when it wraps, for the reason the header is: left alone,
          `ml-auto` would hang the off-site group off the right of a line of
          its own. */}
      <div className="wrap flex flex-wrap items-baseline gap-x-5 gap-y-4 max-phone:justify-center">
        {NAV.filter((n) => n.href !== '/').map(({ href, label }) => (
          <Link key={href} href={href} className={LINK}>
            {label}
          </Link>
        ))}
        {/* Every link that leaves the site, together on one side: the arrow is
            what marks them, and a reader scanning for it should not have to
            find it twice. */}
        <div className="ml-auto flex flex-wrap items-baseline gap-x-5 gap-y-4 max-phone:ml-0 max-phone:justify-center">
          <Ext href={REPO} className={LINK}>
            GitHub
          </Ext>
          {/* Off-site on purpose: the changelog is edited and read as the same
              file, and a rendered copy here is the one that goes stale. */}
          <Ext href={`${REPO}/blob/main/CHANGELOG.md`} className={LINK}>
            Changelog
          </Ext>
          {/* The one link an assistant's crawler can follow to the summary
              written for it: `llms.txt` has no discovery convention behind it. */}
          <Ext href={`${SITE}/llms.txt`} className={LINK}>
            llms.txt
          </Ext>
          <Ext href={`${REPO}/blob/main/LICENSE`} className={LINK}>
            MIT
          </Ext>
        </div>
      </div>
    </footer>
  )
}
