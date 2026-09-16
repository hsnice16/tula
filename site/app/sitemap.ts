import type { MetadataRoute } from 'next'
import { NAV, pageUrl, SITE } from '@/lib/site'

// Static export: written once at build time, like every page beside it.
export const dynamic = 'force-static'

/**
 * Every readable page is `NAV` plus `llms.txt`, derived rather than listed so a
 * new page cannot ship unindexed. What is left out is what a reader would
 * never arrive at: the 404, the assets, `install.sh` and `security.txt`.
 *
 * URLs only. Google ignores `priority` and `changefreq`, and uses `lastmod`
 * only where it is accurate — the build time on every URL is not, and the
 * deploy's shallow clone cannot give each page its own date.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [...NAV.map(({ href }) => ({ url: pageUrl(href) })), { url: `${SITE}/llms.txt` }]
}
