import type { Metadata } from 'next'
import { measured } from '@/components/Analytics'
import { Code } from '@/components/Code'
import { ConsentChoice } from '@/components/ConsentChoice'
import { Ext } from '@/components/Ext'
import { breadcrumb, JsonLd } from '@/components/JsonLd'
import { Link } from '@/components/Link'
import { NAME, OG, REPO, TWITTER } from '@/lib/site'

const TITLE = 'Privacy — what this site measures, and your choice'
const SUMMARY =
  'What usetu.la records about a visit: Google Analytics page views, asked for first in Europe, and nothing from the calculators. The tula binary sends nothing to us.'
const UPDATED = '20 October 2026'

export const metadata: Metadata = {
  title: TITLE,
  description: SUMMARY,
  alternates: { canonical: '/privacy' },
  openGraph: {
    ...OG,
    type: 'website',
    url: '/privacy',
    title: `${TITLE} · ${NAME}`,
    description: SUMMARY,
  },
  twitter: { ...TWITTER, title: `${TITLE} · ${NAME}`, description: SUMMARY },
}

export default function Page() {
  return (
    <main className="wrap animate-fade pt-16 pb-step-3">
      <JsonLd schema={breadcrumb('Privacy', '/privacy')} />
      <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium leading-[1.1] tracking-[-0.025em]">
        Privacy
      </h1>
      <p className="mb-step max-w-[42rem] text-[1.08rem] text-dim">
        This site counts visits and nothing more. The tula binary counts nothing at all.
      </p>

      <div className="max-w-[46rem]">
        <section className="mb-step">
          <h2 className="label mb-4">Your choice</h2>
          <ConsentChoice measured={measured()} />
        </section>

        <section className="mb-step">
          <h2 className="label mb-4">What this site measures</h2>
          <p className="mb-3 text-dim">
            Page views, through Google Analytics 4: the page, where the visit came from, and the
            rough location, device and browser Google derives from it. Google Analytics does not
            store IP addresses. There is no advertising and no other tracker.
          </p>
          <p className="text-dim">
            Its cookies, <Code>_ga</Code> and <Code>_ga_*</Code>, tell one visit from the next. From
            the European Economic Area, the United Kingdom and Switzerland none is set until you
            allow it, and Google receives only cookieless pings that carry no identifier; like any
            server, it still sees the address they come from.
          </p>
        </section>

        <section className="mb-step">
          <h2 className="label mb-4">What else leaves your browser</h2>
          <p className="mb-3 text-dim">
            Nothing you type into a calculator: they work on the page and send nothing anywhere.
          </p>
          <p className="mb-3 text-dim">
            The footer&rsquo;s Peerlist badge is an image from peerlist.io, requested without saying
            which page asked for it.
          </p>
          <p className="text-dim">
            Vercel, which hosts the site, receives each request in order to answer it.
          </p>
        </section>

        <section className="mb-step">
          <h2 className="label mb-4">What is kept in your browser</h2>
          <p className="text-dim">
            Your analytics choice, in this site&rsquo;s local storage. It is never sent anywhere,
            and clearing this site&rsquo;s data removes it, so you are asked again.
          </p>
        </section>

        <section className="mb-step">
          <h2 className="label mb-4">The binary</h2>
          <p className="text-dim">
            tula sends nothing to us. What it does connect to, and why, is on the{' '}
            <Link href="/security">security page</Link>.
          </p>
        </section>

        <p className="text-[0.9rem] text-dim">
          Questions: <Ext href={`${REPO}/issues`}>open an issue</Ext>. Last updated {UPDATED}.
        </p>
      </div>
    </main>
  )
}
