import type { Metadata } from 'next'
import { Link } from '@/components/Link'
import { NAME, NAV, OG, TWITTER } from '@/lib/site'

const TITLE = 'Not found'
const SUMMARY = 'There is nothing at this address. Everything the site publishes is listed here.'

export const metadata: Metadata = {
  // Without one, every 404 carries the front page's title.
  title: TITLE,
  // Next tags this route noindex itself, but the layout's `index, follow` is
  // emitted beside it — restated here so the two tags on the page agree.
  robots: { index: false, follow: true },
  // The layout canonicalises to `/`, which every real page overrides and this
  // one inherited: a 404 that names the front page as its canonical asks a
  // crawler that ignores the noindex to fold every mistyped path into it.
  alternates: { canonical: null },
  // Restated for the same reason as the title: without it the layout's card is
  // inherited whole, and a mistyped link unfurled in a chat as the front page —
  // the one page it is certainly not. No `url`: this file answers for every
  // address on the domain there is nothing at, so it has none of its own.
  openGraph: { ...OG, type: 'website', title: TITLE, description: SUMMARY },
  twitter: { ...TWITTER, title: `${TITLE} · ${NAME}`, description: SUMMARY },
}

/**
 * Static export writes this to `out/404.html`, the file served for every path on
 * the domain there is nothing at — so it is the site's only 404, and it is
 * reached without a route change. The list is `NAV` rather than a home button: a
 * reader who mistyped one path is closer to the page they wanted than a reader
 * starting over.
 */
export default function NotFound() {
  return (
    <main className="wrap pt-16 pb-step-3">
      <p className="eyebrow mb-6">404</p>
      <h1 className="mb-5 max-w-[40rem] text-[clamp(2rem,4.5vw,2.8rem)] font-medium tracking-[-0.025em]">
        There is nothing at this address.
      </h1>
      <p className="mb-step-3 max-w-[36rem] text-[1.05rem] text-dim">
        The link may have moved, or the address may be mistyped. Everything the site publishes is
        below.
      </p>

      <h2 className="label mb-8">Every page</h2>
      <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-[7rem_1fr]">
        {NAV.map(({ href, label, blurb }) => (
          <div key={href} className="contents">
            <dt className="pt-0.5 font-mono text-[0.74rem] uppercase tracking-[0.09em]">
              {/* A 12px line of capitals is a 14px-tall target, and these three
                  links are the whole way out of a dead end on a phone. The
                  `after` takes the tap area to 44 without moving the row — the
                  gap below the term is a blurb, which nothing else can claim. */}
              <Link
                href={href}
                className="relative inline-block text-accent after:absolute after:inset-x-0 after:-top-[15px] after:-bottom-[15px] after:content-['']"
              >
                {label}
              </Link>
            </dt>
            <dd className="max-w-[44rem] text-[0.95rem] text-dim">{blurb}</dd>
          </div>
        ))}
      </dl>
    </main>
  )
}
