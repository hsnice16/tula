export const REPO = 'https://github.com/hsnice16/tula'

export const SITE = 'https://hsnice16.github.io/tula'

/**
 * The one string every install instruction on the site renders. Written out
 * rather than assembled, because the flags are the point: --proto '=https'
 * refuses an HTTP downgrade on redirect and -f fails instead of piping an
 * error page into a shell.
 */
export const INSTALL_COMMAND = `curl --proto '=https' --tlsv1.2 -LsSf ${SITE}/install.sh | sh`

export const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/install', label: 'Install' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/security', label: 'Security' },
] as const
