export const APP_NAME = 'tula'
export const APP_VERSION = '0.3.0'
export const IS_PRE_RELEASE = true
export const REPO_URL = 'https://github.com/hsnice16/tula'

/**
 * Where the site and the installer are published. Canonical: `install.sh`,
 * `site/lib/site.ts` and `package.json` each restate it because they cannot
 * import from here — the installer is a standalone artifact and the site is a
 * separate package — and `scripts/guard.sh` fails the build when they disagree.
 * Change it here, run `bun run guard`, and it names anything left behind.
 */
export const SITE_URL = 'https://hsnice16.github.io/tula'

export const APP_DESCRIPTION = 'See your true exposure across every venue you trade on.'
