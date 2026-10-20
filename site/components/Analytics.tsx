import Script from 'next/script'
import { CONSENT_KEY, CONSENT_REGIONS } from '@/lib/consent'
import { GA_MEASUREMENT_ID } from '@/lib/site'

/**
 * The site's page views, and nothing else. The binary is not measured, and the
 * security page says so where it lists what leaves your machine.
 *
 * Off outside a production build, or `next dev` would file the developer's own
 * reading as traffic — and off on a preview, which builds as production too and
 * is a second origin serving these same pages. This renders on the server, so
 * `VERCEL_ENV` is read at build time and needs no `NEXT_PUBLIC_`; a host that
 * sets none is taken for the real one rather than left silently untagged.
 *
 * No `anonymize_ip`: GA4 truncates the address itself and ignores the
 * parameter, so passing it would advertise a control that is not ours to offer.
 *
 * Consent Mode denies storage by default in `CONSENT_REGIONS`, and a choice the
 * visitor made applies wherever they are. Both are queued before `config`, or
 * the first page view would go out under no consent at all.
 */
export function Analytics() {
  if (!measured()) return null

  return (
    <>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      />
      <Script id="ga" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('consent', 'default', {
          analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied',
          ad_personalization: 'denied', wait_for_update: 500,
          region: ${JSON.stringify(CONSENT_REGIONS)}
        });
        gtag('consent', 'default', {
          analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied',
          ad_personalization: 'denied'
        });
        try {
          var choice = localStorage.getItem(${JSON.stringify(CONSENT_KEY)});
          if (choice === 'granted' || choice === 'denied') {
            gtag('consent', 'update', { analytics_storage: choice });
          }
        } catch (e) {}
        gtag('js', new Date());
        gtag('config', '${GA_MEASUREMENT_ID}');
      `}</Script>
    </>
  )
}

/** Whether this build carries the tag, and so whether there is anything to ask about. */
export function measured(): boolean {
  if (process.env.NODE_ENV !== 'production') return false
  return (process.env.VERCEL_ENV ?? 'production') === 'production'
}
