import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Analytics } from '@/components/Analytics'
import { Footer } from '@/components/Footer'
import { JsonLd } from '@/components/JsonLd'
import { Nav } from '@/components/Nav'
import { BackToTop, ScrollToTop } from '@/components/Scroll'
import { AUTHOR, DESCRIPTION, KEYWORDS, NAME, OG, REPO, SITE, TWITTER } from '@/lib/site'
import './globals.css'

const TITLE = 'tula — your true exposure, and what breaks first'

export const metadata: Metadata = {
  // Absolute, and it carries the `/tula` path: every canonical, OG image and
  // sitemap URL is resolved against it, and a metadataBase without the base
  // path publishes links to an origin that serves somebody else's account page.
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: `%s · ${NAME}` },
  description: DESCRIPTION,
  keywords: KEYWORDS,
  applicationName: NAME,
  creator: AUTHOR.name,
  authors: [{ name: AUTHOR.name, url: AUTHOR.url }],
  alternates: { canonical: '/' },
  openGraph: { ...OG, type: 'website', url: '/', title: TITLE, description: DESCRIPTION },
  twitter: { ...TWITTER, title: TITLE, description: DESCRIPTION },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
    },
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  // The ground the page is painted on, so a mobile browser's own chrome does
  // not sit a white bar above a near-black page.
  themeColor: '#131211',
}

const SCHEMA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Person',
      '@id': `${SITE}/#author`,
      name: AUTHOR.name,
      url: AUTHOR.url,
      sameAs: [AUTHOR.url],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE}/#site`,
      url: `${SITE}/`,
      name: NAME,
      description: DESCRIPTION,
      inLanguage: 'en',
      author: { '@id': `${SITE}/#author` },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE}/#app`,
      name: NAME,
      url: `${SITE}/`,
      description: DESCRIPTION,
      applicationCategory: 'FinanceApplication',
      applicationSubCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Linux',
      // Windows is reachable through WSL, where it is Linux. Naming it here
      // would promise a native build the release does not produce.
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: `${REPO}/blob/main/LICENSE`,
      codeRepository: REPO,
      downloadUrl: `${SITE}/install/`,
      author: { '@id': `${SITE}/#author` },
      isPartOf: { '@id': `${SITE}/#site` },
    },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `data-scroll-behavior` is how Next is told the page scrolls smoothly:
    // without it, it warns, and it leaves its own scrolls animated too.
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <JsonLd schema={SCHEMA} />
        <Analytics />
        {/* The header lives here rather than on each page so that one instance
            of it survives a route change — an underline that remounts cannot
            travel from where it was. */}
        <Nav />
        {children}
        <Footer />
        <ScrollToTop />
        <BackToTop />
      </body>
    </html>
  )
}
