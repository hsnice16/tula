import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { breadcrumb, JsonLd } from '@/components/JsonLd'
import { Frame } from '@/components/Terminal'
import { NAME, OG, pageUrl, SITE, TWITTER } from '@/lib/site'

/** The metadata every other page spells out by hand, for the seven that share a shape. */
export function guideMetadata(path: string, title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    // Both carry the brand: `title.template` does not reach an explicitly set
    // `openGraph.title`, so an unfurl was unbranded where a card was not.
    openGraph: { ...OG, type: 'website', url: path, title: `${title} · ${NAME}`, description },
    twitter: { ...TWITTER, title: `${title} · ${NAME}`, description },
  }
}

/**
 * A page written for one search: what the venue or the concept is, in its own
 * terms, then what tula reads and how to try it. The `WebPage` node restates the
 * title and description and nothing else — not `TechArticle`, which wants dates
 * the static build cannot state truthfully.
 */
export function Guide({
  path,
  label,
  title,
  heading,
  description,
  lead,
  children,
}: {
  path: string
  label: string
  title: string
  heading: string
  description: string
  lead: string
  children: ReactNode
}) {
  const page = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${pageUrl(path)}#page`,
    url: pageUrl(path),
    name: title,
    description,
    inLanguage: 'en',
    isPartOf: { '@id': `${SITE}/#site` },
    about: { '@id': `${SITE}/#app` },
  }
  return (
    <main className="wrap pt-16 pb-step-3">
      <JsonLd schema={breadcrumb(label, path)} />
      <JsonLd schema={page} />
      <h1 className="mb-5 max-w-[46rem] text-[clamp(2rem,4.5vw,2.8rem)] font-medium leading-[1.1] tracking-[-0.025em]">
        {heading}
      </h1>
      <p className="mb-step max-w-[42rem] text-[1.08rem] text-dim">{lead}</p>
      <div className="max-w-[46rem]">{children}</div>
    </main>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-step">
      <h2 className="label mb-4">{title}</h2>
      {children}
    </section>
  )
}

/** What tula prints, in the frame that says so — without the copy button a command gets. */
export function Output({ title, children }: { title: string; children: string }) {
  return (
    <Frame title={title}>
      <pre className="overflow-x-auto px-4 pb-5 pt-4 font-mono text-[0.8rem] leading-[1.62]">
        {children}
      </pre>
    </Frame>
  )
}
