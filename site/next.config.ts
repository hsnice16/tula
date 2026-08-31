import type { NextConfig } from 'next'

/**
 * Static export: GitHub Pages serves files, not a Node server. `basePath` is the
 * repository name because a project site lives at /<repo>/ — without it every
 * asset 404s at the deployed origin while working perfectly in `next dev`.
 * A custom apex domain would drop this and add a public/CNAME instead.
 */
const config: NextConfig = {
  output: 'export',
  basePath: '/tula',
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
