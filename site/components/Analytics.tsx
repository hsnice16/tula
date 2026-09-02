import Script from 'next/script'
import { GA_MEASUREMENT_ID } from '@/lib/site'

/**
 * The site's page views, and nothing else. The binary is not measured, and the
 * security page says so where it lists what leaves your machine.
 *
 * Off outside a production build, or `next dev` would file the developer's own
 * reading as traffic. No `anonymize_ip`: GA4 truncates the address itself and
 * ignores the parameter, so passing it would advertise a control that is not
 * ours to offer.
 */
export function Analytics() {
  if (process.env.NODE_ENV !== 'production') return null

  return (
    <>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      />
      <Script id="ga" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${GA_MEASUREMENT_ID}');
      `}</Script>
    </>
  )
}
