/**
 * Enough SemVer to answer one question: is the release GitHub is offering newer
 * than the build asking? A dependency for this would be a dependency in the one
 * place a wrong answer installs something over a working binary.
 *
 * Pre-releases sort below the version they lead to, which is what SemVer says
 * and what matters here in one direction: somebody running `0.2.0-rc.1` must
 * not be told `0.2.0` is older than what they have.
 */

const parts = (core: string): number[] =>
  core.split('.').map((n) => {
    const value = Number.parseInt(n, 10)
    return Number.isNaN(value) ? 0 : value
  })

/** Negative if `a` is older, positive if newer, zero if the same. */
function compareVersions(a: string, b: string): number {
  const [coreA = '', preA = ''] = a.replace(/^v/, '').split('-', 2)
  const [coreB = '', preB = ''] = b.replace(/^v/, '').split('-', 2)

  const left = parts(coreA)
  const right = parts(coreB)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }

  // Same core: a build with no pre-release tag is the finished one.
  if (preA === preB) return 0
  if (preA === '') return 1
  if (preB === '') return -1
  return preA < preB ? -1 : 1
}

export const isNewer = (candidate: string, running: string): boolean =>
  compareVersions(candidate, running) > 0
