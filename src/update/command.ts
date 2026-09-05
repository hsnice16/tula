import { TulaError } from '../core/errors.js'
import { APP_VERSION, SITE_URL } from '../version.js'
import { applyUpdate } from './apply.js'
import { availableNow } from './check.js'
import { nativeInstall, OTHER_CHANNELS } from './channel.js'

export interface UpdateResult {
  output: string
  /** Set when the command could not do what it was asked, for the exit code. */
  failed?: boolean
}

/**
 * Two steps, not a prompt. `/update` says what it would do and `/update install`
 * does it, which is a confirmation that works the same in the shell and in a
 * one-shot `tula update` — a y/N read from stdin works in neither reliably, and
 * a second command is a thing somebody has to mean to type.
 *
 * The plan names the release page on purpose. A checksum proves the archive is
 * the one whose hash was published beside it; it cannot prove that the release
 * is one this project meant to publish. The reader looking at the tag and the
 * changelog is the only check there is for that, so the command asks for it
 * rather than implying the download alone settles the question.
 */
export async function update(args: string[]): Promise<UpdateResult> {
  const sub = args[0]?.toLowerCase()
  if (sub && sub !== 'install') {
    return { output: `/update has no "${sub}". Run /update, or /update install.`, failed: true }
  }

  const native = await nativeInstall()
  const available = await availableNow()

  if (!available) {
    return { output: `tula ${APP_VERSION} is the newest release.` }
  }

  if (!native) {
    return {
      output: [
        `tula ${available.version} is out — you have ${APP_VERSION}.`,
        '',
        'This build was not installed by the install script, so tula will not',
        'replace it: your package manager would go on reporting the old version.',
        `  ${OTHER_CHANNELS}`,
        `  ${available.release}`,
      ].join('\n'),
    }
  }

  if (sub !== 'install') {
    return {
      output: [
        `${APP_VERSION} → ${available.version}`,
        '',
        `  Release   ${available.release}`,
        `  Notes     ${SITE_URL}/install/`,
        '',
        'Open those and check they say what you expect before going ahead.',
        'The download is checked against its published checksum. Who built it',
        'is not checked: that needs the GitHub CLI, signed in.',
        '',
        '  /update install   download it and switch to it',
      ].join('\n'),
    }
  }

  try {
    await applyUpdate(available.version, native)
  } catch (err) {
    if (err instanceof TulaError) return { output: err.message, failed: true }
    throw err
  }

  return {
    output: [
      `Installed tula ${available.version}.`,
      `${APP_VERSION} is still on disk, so going back is a link away.`,
      '',
      'Restart tula to run it.',
    ].join('\n'),
  }
}
