export const APP_NAME = 'tula'
export const APP_VERSION = '0.1.0'

/**
 * SemVer says a hyphen means pre-release, and `release.yml` already reads it
 * that way to choose `--prerelease` over `--latest` and the npm dist-tag. This
 * derives rather than restates it: the two were a hand-set boolean apart, and
 * they had already drifted — a stable GitHub release whose binary printed
 * "pre-release".
 */
export const IS_PRE_RELEASE = APP_VERSION.includes('-')
export const REPO_URL = 'https://github.com/hsnice16/tula'

/**
 * Where the site and the installer are published. Canonical: `install.sh`,
 * `site/lib/site.ts` and `package.json` each restate it because they cannot
 * import from here — the installer is a standalone artifact and the site is a
 * separate package — and `scripts/guard.sh` fails the build when they disagree.
 * Change it here, run `bun run guard`, and it names anything left behind.
 */
export const SITE_URL = 'https://hsnice16.github.io/tula'

export const APP_DESCRIPTION = 'Your true exposure, what breaks first, and more, across every venue at once.'
