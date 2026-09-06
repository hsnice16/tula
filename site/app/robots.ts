import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/site'

// Static export: written once at build time, like every page beside it.
export const dynamic = 'force-static'

/**
 * Named one by one rather than left to the `*` rule, because several of these
 * read an explicit allow and nothing else. tula is a tool people ask an
 * assistant about before they install it, so the assistants' crawlers are the
 * audience this file is written for.
 */
const ASSISTANT_CRAWLERS = [
  'CCBot',
  'GPTBot',
  'YouBot',
  'Diffbot',
  'Amazonbot',
  'ClaudeBot',
  'Cohere-AI',
  'Claude-Web',
  'anthropic-ai',
  'ChatGPT-User',
  'DuckAssistBot',
  'OAI-SearchBot',
  'PerplexityBot',
  'Google-Extended',
  'Perplexity-User',
  'Applebot-Extended',
  'Meta-ExternalAgent',
]

/**
 * Discovery does not lean on this: `llms.txt` is linked from the footer of every
 * page, and the sitemap is submitted by hand.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    sitemap: `${SITE}/sitemap.xml`,
    rules: [
      { userAgent: '*', allow: '/' },
      { userAgent: ASSISTANT_CRAWLERS, allow: '/' },
    ],
  }
}
