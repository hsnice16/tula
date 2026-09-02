import type { Metadata } from 'next'
import { Link } from '@/components/Link'
import { NAV } from '@/lib/site'

export const metadata: Metadata = {
  // Without one, every 404 carries the front page's title.
  title: 'Not found',
  // Next tags this route noindex itself, but the layout's `index, follow` is
  // emitted beside it — restated here so the two tags on the page agree.
  robots: { index: false, follow: true },
}

/**
 * Static export writes this to `out/404.html`, which is the file GitHub Pages
 * serves for every path it has nothing at — so it is the site's only 404, and
 * it is reached without a route change. The list is `NAV` rather than a home
 * button: a reader who mistyped one path is closer to the page they wanted than
 * a reader starting over.
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

      <p className="label mb-8">Every page</p>
      <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-[7rem_1fr]">
        {NAV.map(({ href, label, blurb }) => (
          <div key={href} className="contents">
            <dt className="pt-0.5 font-mono text-[0.74rem] uppercase tracking-[0.09em]">
              <Link href={href} className="text-accent">
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
