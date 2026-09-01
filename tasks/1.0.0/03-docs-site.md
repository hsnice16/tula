# 03 · Docs site

**Status**: done · GitHub Pages at hsnice16.github.io/tula; a custom domain is deferred

## Goal

A canonical origin a user can check before trusting a binary.

## Acceptance

- An overview, install and the security model, each on one page. Connecting is
  part of install, not a fourth page.
- A canonical page users can check before trusting a binary - impersonation defence.
- The install script is served from the documented origin only.
- The changelog and the roadmap are not published — they stay in the repository.

## Notes

Next.js 16 + Tailwind 4, static-exported to GitHub Pages by
`.github/workflows/pages.yml`. `site/` is a separate package with its own
lockfile, so the site's dependency tree never joins the binary's — the
supply-chain rule in AGENTS.md is about the process that reads exchange keys, and
a static site is not that process.

The first attempt was hand-written HTML with no build step. It was rejected on
looks, and rightly: rendering the reference sites headlessly rather than reading
their markup showed a shared language none of it had — near-black rather than
warm brown, mono for every piece of chrome, a terminal window with real window
chrome as the hero visual, and full-bleed hairline bands instead of one centred
column of prose.

`tula.trade` and `tula.xyz` were both already registered, and `tula.sh` is the
priciest of the free options. The domain was deferred rather than bought, because
the trust anchor is the GitHub artifact attestation, not the hostname - see
`../0.8.0/02-artifact-attestations.md`. Pages serves a canonical origin today for
nothing; point a domain at it when there is a binary worth installing.

The install page deliberately documents that no install script exists yet, and
says a `curl | sh` claiming to be tula did not come from this project. A docs site
describing an install path that does not exist is an impersonation surface, not a
convenience. `scripts/guard.sh` now holds `site/` to the same language rule as
`src/`.

The site did render `/changelog` and `/roadmap` from `CHANGELOG.md`, `ROADMAP.md`
and the `**Status**:` lines under `tasks/`, which made drift impossible but tied
every status edit to a Pages deploy. They were dropped rather than transcribed:
GitHub already renders those files at the place they are edited.
