import type { MetadataRoute } from 'next'
import { NAV, pageUrl, SITE } from '@/lib/site'

// Static export: written once at build time, like every page beside it.
export const dynamic = 'force-static'

/**
 * The whole site is `NAV` plus `llms.txt`; there is no route the header does
 * not show. Derived rather than listed so a fourth page cannot ship unindexed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // The site is static, so "last modified" is the build that published it —
  // which is the only change a crawler could ever be told about.
  const built = new Date()

  return [
    ...NAV.map(({ href }) => ({
      url: pageUrl(href),
      lastModified: built,
      changeFrequency: 'monthly' as const,
      priority: href === '/' ? 1 : 0.8,
    })),
    {
      url: `${SITE}/llms.txt`,
      lastModified: built,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    },
  ]
}
