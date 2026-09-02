import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Footer } from '@/components/Footer'
import { Nav } from '@/components/Nav'
import { BackToTop, ScrollToTop } from '@/components/Scroll'
import './globals.css'

export const metadata: Metadata = {
  title: 'tula — your true exposure, what breaks first, and more, across every venue at once',
  description:
    'A terminal tool that answers what no single venue can: what is my real exposure, and what breaks first? Non-custodial, and read-only for the moment — placing trades will come later.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `data-scroll-behavior` is how Next is told the page scrolls smoothly:
    // without it, it warns, and it leaves its own scrolls animated too.
    <html lang="en" data-scroll-behavior="smooth">
      <body>
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
