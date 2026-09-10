# 03 · Docs site

**Status**: done · Vercel at usetu.la
**Covered by**: `src/site-claims.test.ts`, `src/site-example.test.ts`, `scripts/guard.sh`

## Goal

A canonical origin a user can check before trusting a binary.

## Acceptance

- An overview, install and the security model, each on one page. Connecting is
  part of install, not a fourth page.
- A canonical page users can check before trusting a binary - impersonation defence.
- The install script is served from the documented origin only.
- The changelog and the roadmap are not published — they stay in the repository.

## Notes

Next.js 16 + Tailwind 4, static-exported and deployed by Vercel. `site/` is a
separate package with its own lockfile, so the site's dependency tree never joins
the binary's — the supply-chain rule in AGENTS.md is about the process that reads
exchange keys, and a static site is not that process.

It was on GitHub Pages first, which cannot set a response header at all. The
export stayed after the move: every route is prerendered, so the origin serving
`install.sh` still runs no code of ours, and `vercel.json` carries the headers
Pages had no way to send.

The first attempt was hand-written HTML with no build step. It was rejected on
looks, and rightly: rendering the reference sites headlessly rather than reading
their markup showed a shared language none of it had — near-black rather than
warm brown, mono for every piece of chrome, a terminal window with real window
chrome as the hero visual, and full-bleed hairline bands instead of one centred
column of prose.

`tula.trade`, `tula.xyz` and `tula.sh` were all taken or priced out; `usetu.la`
reads as the sentence rather than the word. It is a hostname and not the trust
anchor — that is still the artifact attestation, see
`../distribution/02-artifact-attestations.md` — so what the domain buys is one origin
short enough to be typed from memory and checked against.

Owning the origin root is what makes `robots.txt` and `.well-known/security.txt`
load-bearing rather than inert; both were written for the project path, where a
crawler never fetched them. Discovery still does not rest on `robots.txt`:
`llms.txt` is linked from the footer of every page and the sitemap is submitted
by hand.

The install page shipped before the script did and said so, documenting that no
install script existed yet and that a `curl | sh` claiming to be tula had not
come from this project: a docs site describing an install path that does not
exist is an impersonation surface, not a convenience. The script is published
now. `scripts/guard.sh` holds `site/` to the same language rule as `src/`.

The site did render `/changelog` and `/roadmap` from `CHANGELOG.md`, `ROADMAP.md`
and the `**Status**:` lines under `tasks/`, which made drift impossible but tied
every status edit to a deploy — of Pages then, of Vercel now, and the coupling is
the same either way. They were dropped rather than transcribed, and the reason
that outlasts the host is the second one: GitHub already renders those files at
the place they are edited, so the repository is where they are written and read
as one file.
