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
  'flex min-h-8 items-center text-dim underline decoration-rule decoration-dotted underline-offset-4 hover:text-accent'

/** On a phone the two guide columns pair up under Pages and More links. */
const SHELVES = [
  {
    shelf: 'venue',
    title: 'Venues',
    phone: 'max-phone:order-3 max-phone:min-w-[40%] max-phone:flex-1',
  },
  {
    shelf: 'topic',
    title: 'Guides',
    phone: 'max-phone:order-4 max-phone:min-w-[40%] max-phone:flex-1',
  },
] as const

type Entry = (typeof NAV)[number]
const under = (n: Entry) => ('under' in n ? n.under : undefined)

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
        {/* The badge's 296px is a floor only when it fails to load: a broken
            image stops shrinking with its box and pans the page sideways. */}
        <div className="max-w-full">
          <p className="flex min-h-8 flex-wrap items-center gap-x-2">
            <span>©</span>
            <Ext href={AUTHOR.url} className={LINK}>
              {AUTHOR.name}
            </Ext>
            <span aria-hidden="true">·</span>
            <Ext href={`${REPO}/blob/main/LICENSE`} className={LINK}>
              MIT
            </Ext>
            <span aria-hidden="true">·</span>
            <span className="flex min-h-8 items-center gap-x-2">
              also made
              <Ext href="https://agentfriendlycode.com/" className={LINK}>
                Agent Friendly Code
              </Ext>
            </span>
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

        {/* Below `phone`, columns pair up in a set order: wrapping on their own
            leaves one stranded beside nothing. Flex rather than a grid, so at
            200% zoom a pair stacks instead of spilling past a column. */}
        <div className="flex flex-wrap gap-x-10 gap-y-8 max-phone:w-full max-phone:gap-x-8">
          <Column
            title="Pages"
            className="max-phone:order-1 max-phone:min-w-[40%] max-phone:flex-1"
          >
            {NAV.filter((n) => n.group === 'site').map(({ href, label }) => (
              <Link key={href} href={href} className={LINK}>
                {label}
              </Link>
            ))}
          </Column>
          {/* Every guide, by shelf; AGENTS.md's guides rule says why. */}
          {SHELVES.map(({ shelf, title, phone }) => (
            <Column key={shelf} title={title} className={phone}>
              {/* Alphabetical, so a reader scanning for a venue finds it where
                  they expect it, and a new guide lands in its place unasked. */}
              {NAV.filter((n) => 'shelf' in n && n.shelf === shelf && !under(n))
                .sort((a, b) => a.label.localeCompare(b.label))
                .flatMap((parent) => [
                  <Link key={parent.href} href={parent.href} className={LINK}>
                    {parent.label}
                  </Link>,
                  // In NAV's order, not alphabetical: a venue's pages read as a set.
                  ...NAV.filter((n) => under(n) === parent.href).map((n) => (
                    <Link key={n.href} href={n.href} className={`${LINK} pl-4`}>
                      {'footerLabel' in n ? n.footerLabel : n.label}
                    </Link>
                  )),
                ])}
            </Column>
          ))}
          {/* Alphabetical, as the guides are. */}
          <Column
            title="More links"
            className="max-phone:order-2 max-phone:min-w-[40%] max-phone:flex-1"
          >
            {/* Off-site on purpose: the changelog is edited and read as the same
                file, and a rendered copy here is the one that goes stale. */}
            <Ext href={`${REPO}/blob/main/CHANGELOG.md`} className={LINK}>
              Changelog
            </Ext>
            <Ext href={REPO} className={LINK}>
              GitHub
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
