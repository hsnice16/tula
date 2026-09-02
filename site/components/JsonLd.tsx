import { pageUrl } from '@/lib/site'

/**
 * Structured data, for the readers that never see the page: search engines, and
 * the crawlers behind the assistants people now ask about tools like this one.
 * Everything here restates what the page already says in prose — schema.org is
 * a second encoding of the same claim, never a place to make a new one.
 */
export function JsonLd({ schema }: { schema: object }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: a JSON-LD block has to be raw script content. The payload is built here, and `<` is escaped so nothing in it can close the tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }}
    />
  )
}

/**
 * The trail from the home page to this one. Two levels is the whole site, so
 * the caller passes the leaf and nothing else.
 */
export function breadcrumb(name: string, path: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Overview', item: pageUrl('/') },
      { '@type': 'ListItem', position: 2, name, item: pageUrl(path) },
    ],
  }
}
