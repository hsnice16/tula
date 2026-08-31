import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Footer } from '@/components/Footer'
import './globals.css'

export const metadata: Metadata = {
  title: 'tula — see your true exposure across every venue you trade on',
  description:
    'A terminal tool that answers what no single venue can: what is my real exposure, and what breaks first? Read-only, non-custodial, and it cannot move your money.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Footer />
      </body>
    </html>
  )
}
