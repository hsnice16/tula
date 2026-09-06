import type { NextConfig } from 'next'

/**
 * Static export: every route here is prerendered, so a deploy is a directory of
 * files and the origin serving `install.sh` runs no code of ours. The cost is
 * that `headers()` and `redirects()` are ignored in this file — the response
 * headers live in `vercel.json` instead.
 */
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // AGENTS.md at the repository root is the single source of truth; `next dev`
  // otherwise writes a second AGENTS.md and CLAUDE.md in here on every run.
  agentRules: false,
  // Two lockfiles is the point — the site's dependency tree must never join the
  // binary's — so name this one rather than let Next infer the repository root
  // and warn about it on every run.
  turbopack: { root: import.meta.dirname },
}

export default config
