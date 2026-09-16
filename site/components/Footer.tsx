import type { ReactNode } from 'react'
import { Ext } from '@/components/Ext'
import { Link } from '@/components/Link'
import { AUTHOR, NAV, REPO, SITE } from '@/lib/site'

/** Peerlist's own embed, at the size it is served, so the footer does not move when it loads. */
const PEERLIST = {
  href: 'https://peerlist.io/hsnice16/project/tula',
  src: 'https://peerlist.io/api/v1/projects/embed/PRJH6A7Q86ELK9DE939A87ND8MAKE6?showUpvote=true&theme=dark',
  width: 296,
  height: 72,
} as const

/**
 * A 32px row per link: a list that reads as one, with each target above WCAG
 * 2.2's 24px minimum. Stacked links cannot borrow target from the space around
 * them without handing their taps to the next.
 */
const LINK =
  'flex min-h-11 items-center text-dim underline decoration-rule decoration-dotted underline-offset-4 hover:text-accent'

function Column({
  title,
  className = '',
  children,
}: {
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <nav aria-label={title} className={className}>
      <p className="mb-3 flex min-h-8 items-center text-[0.75rem] uppercase tracking-[0.09em]">
        {title}
      </p>
      {children}
    </nav>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-rule bg-bg/85 py-10 font-mono text-[0.8rem] text-dim backdrop-blur">
      <div className="wrap flex flex-wrap items-start justify-between gap-x-16 gap-y-10">
        <div>
          <p className="flex min-h-8 flex-wrap items-center gap-x-2">
            <span>©</span>
            <Ext href={AUTHOR.url} className={LINK}>
              {AUTHOR.name}
            </Ext>
            <span aria-hidden="true">·</span>
            <Ext href={`${REPO}/blob/main/LICENSE`} className={LINK}>
              MIT
            </Ext>
          </p>
          {/* No referrer: the badge is the one request this site sends to Peerlist,
              and which page it was loaded on is not Peerlist's to know. */}
          <Ext href={PEERLIST.href} bare className="mt-4 inline-block max-w-full">
            {/* biome-ignore lint/performance/noImgElement: the export ships images unoptimized, so next/image would render this same tag behind more script. */}
            <img
              src={PEERLIST.src}
              alt="tula on Peerlist"
              width={PEERLIST.width}
              height={PEERLIST.height}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="h-auto max-w-full"
            />
          </Ext>
        </div>

        {/* Below `phone`, the two short columns share a row and Guides takes the
            full width under them: three columns wrapping on their own leave one
            stranded beside nothing. */}
        <div className="flex flex-wrap gap-x-16 gap-y-8 max-phone:grid max-phone:w-full max-phone:grid-cols-2">
          <Column title="Pages">
            {NAV.filter((n) => n.group === 'site').map(({ href, label }) => (
              <Link key={href} href={href} className={LINK}>
                {label}
              </Link>
            ))}
          </Column>
          {/* Pages written for a search, linked here and nowhere more prominent.
              A crawler weighs a page by the links to it, and a hidden link is
              spam by Google's own policy. */}
          <Column title="Guides" className="max-phone:order-last max-phone:col-span-2">
            {NAV.filter((n) => n.group === 'guide').map(({ href, label }) => (
              <Link key={href} href={href} className={LINK}>
                {label}
              </Link>
            ))}
          </Column>
          <Column title="More links">
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
          </Column>
        </div>
      </div>
    </footer>
  )
}
