import type { Metadata } from 'next'
import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { breadcrumb, JsonLd } from '@/components/JsonLd'
import { Terminal } from '@/components/Terminal'
import { INSTALL_COMMAND, NAME, OG, REPO, SITE, TWITTER } from '@/lib/site'

const TITLE = 'Install — one command, and every download checked'
const SUMMARY =
  'Install tula on macOS or Linux with one command. Every release carries a published checksum and a sigstore-backed build attestation, and the installer refuses a binary that does not match. Also on Homebrew and npm.'

export const metadata: Metadata = {
  title: TITLE,
  description: SUMMARY,
  alternates: { canonical: '/install' },
  openGraph: { ...OG, type: 'website', url: '/install', title: TITLE, description: SUMMARY },
  twitter: { ...TWITTER, title: `${TITLE} · ${NAME}`, description: SUMMARY },
}

const CHECKS = [
  ['Published checksum', 'Always. Refuses a download that does not match.'],
  [
    'Build attestation',
    'Sigstore-backed, keyless. Refuses a binary this repo did not build — where the GitHub CLI is installed and signed in to check it.',
  ],
  ['Versioned installs', '~/.tula/versions, behind a symlink. Going back is a link flip.'],
] as const

const FLAGS = [
  ["--proto '=https'", 'Only HTTPS, on redirects too'],
  ['--tlsv1.2', 'Nothing older than TLS 1.2'],
  ['-L', 'Follow a redirect'],
  ['-s', 'No progress bar'],
  ['-S', 'But still show errors'],
  ['-f', 'Stop on an HTTP error, so an error page is never piped into a shell'],
] as const

/**
 * What the reader is really asking is "will it run on mine?", so the rows are
 * systems rather than the four build targets — the two that have no build are
 * the rows most worth printing, and a target list cannot carry them.
 */
const SYSTEMS = [
  ['macOS', 'Yes', 'Intel and ARM, 64-bit.'],
  ['Linux', 'Yes', 'Intel and ARM, 64-bit. Needs glibc.'],
  ['Alpine, or any musl Linux', 'No', 'The installer says so and stops.'],
  ['Windows', 'Through WSL', 'Install inside WSL, where it is Linux. There is no native build.'],
] as const

export default function Page() {
  return (
    <main className="wrap pt-16 pb-step-3">
      <JsonLd schema={breadcrumb('Install', '/install')} />
      <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium tracking-[-0.025em]">
        Install
      </h1>
      <p className="mb-10 max-w-[36rem] text-[1.05rem] text-dim">
        One file, and nothing else to install beside it.
      </p>

      <Terminal title="install">{INSTALL_COMMAND}</Terminal>

      {/* A legend for the command directly above, so it sits tight under it —
            justified across the full column reads as two unrelated lists. */}
      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-7 gap-y-1.5 text-[0.82rem]">
        {FLAGS.map(([flag, why]) => (
          <div key={flag} className="contents">
            <dt className="font-mono text-notice">{flag}</dt>
            <dd className="text-faint">{why}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 mb-step-3 max-w-[42rem] text-[0.9rem] text-faint">
        This pipes a script into a shell, so read it before you run it.{' '}
        <Ext href={`${SITE}/install.sh`}>install.sh</Ext> is what the command fetches, copied
        straight from <Ext href={`${REPO}/blob/main/install.sh`}>the one in the repo</Ext> — the
        same file, and the one every test runs against.
      </p>

      <p className="label mb-8">Every install is checked</p>
      {/* Three columns only where they are wide enough for a sentence. At the
          `sm` these took, the longest ran six lines beside a neighbour of
          three. */}
      <div className="mb-step-3 grid gap-px overflow-hidden rounded border border-rule bg-rule md:grid-cols-3">
        {CHECKS.map(([title, body]) => (
          <div key={title} className="bg-bg px-5 py-5">
            <h2 className="mb-1.5 text-[0.95rem] font-semibold text-ink">{title}</h2>
            <p className="text-[0.88rem] leading-relaxed text-dim">{body}</p>
          </div>
        ))}
      </div>

      <p className="label mb-8">What it runs on</p>
      {/* Below the table's own width every row is a block instead. The note is
          what answers "will it run on mine?", and scrolled sideways it sits off
          a phone with nothing to say it is there. */}
      <div className="mb-step-3 sm:overflow-x-auto">
        <table className="block w-full border-collapse text-[0.89rem] sm:table sm:min-w-[34rem]">
          <tbody className="block sm:table-row-group">
            {SYSTEMS.map(([system, works, note]) => (
              <tr
                key={system}
                className="block border-b border-rule py-3 sm:table-row sm:border-b-0 sm:py-0"
              >
                <td className="inline-block text-ink sm:table-cell sm:w-56 sm:border-b sm:border-rule sm:px-3 sm:py-2.5 sm:align-top">
                  {system}
                </td>
                <td className="ml-3 inline-block font-mono text-[0.8rem] text-notice sm:ml-0 sm:table-cell sm:w-32 sm:border-b sm:border-rule sm:px-3 sm:py-2.5 sm:align-top">
                  {works}
                </td>
                <td className="block text-dim sm:table-cell sm:border-b sm:border-rule sm:px-3 sm:py-2.5 sm:align-top">
                  {note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="label mb-8">Other channels</p>
      <div className="mb-step-3 max-w-[46rem]">
        <p className="mb-5 text-dim">
          The same binary. Homebrew serves the attested archive; npm repackages it, so its tarball
          carries no attestation — verify through Homebrew or the install script.
        </p>
        <Terminal title="brew · npm">
          {'brew install hsnice16/tap/tula\nnpm install -g @tula/cli'}
        </Terminal>
      </div>

      <p className="label mb-8">Verify it yourself</p>
      <div className="mb-step-3 max-w-[46rem]">
        <Terminal title="verify">
          {
            'curl -fLO https://github.com/hsnice16/tula/releases/download/v0.1.0/tula-v0.1.0-darwin-arm64.tar.gz\ngh attestation verify tula-v0.1.0-darwin-arm64.tar.gz --repo hsnice16/tula'
          }
        </Terminal>
        <p className="mt-4 text-dim">
          A checksum served beside a file only proves it is intact. This proves who built it. The
          attestation covers the archive, not the binary inside it, and the installer keeps no copy
          — so the download is the first step, not a repeat of one.
        </p>
        <p className="mt-4 text-dim">
          You need the GitHub CLI, signed in with <Code>gh auth login</Code>. It will not fetch an
          attestation without a token, even for a public repository.
        </p>
      </div>

      <p className="label mb-8">Where it puts things</p>
      <div className="mb-step-3 max-w-[46rem]">
        <p className="mb-4 text-dim">
          Everything lives under <Code>~/.tula</Code>. Each version goes in its own folder, and{' '}
          <Code>~/.tula/bin/tula</Code> is a link to the one you are running. Your keys are kept
          somewhere else, <Code>~/.config/tula</Code>, so a reinstall never touches them.
        </p>
        <p className="mb-4 text-dim">
          If <Code>~/.tula/bin</Code> is not on your PATH, the installer adds a line to your zsh,
          bash or fish profile and tells you which file it changed. Under any other shell it prints
          the line for you to add and edits nothing. Set <Code>TULA_NO_MODIFY_PATH=1</Code> and it
          prints rather than edits, whatever your shell.
        </p>
        <p className="text-dim">
          To install one exact version instead of the newest, set <Code>TULA_VERSION</Code>. Pin it
          that way in CI, and set <Code>TULA_REQUIRE_ATTESTATION=1</Code> to make a missing
          provenance check a refusal rather than a warning.
        </p>
      </div>

      <p className="label mb-8">Update, go back, remove</p>
      {/* One frame each, never three lines in one. They are alternatives, and a
          reader who selects a block and pastes it should not install, relink and
          then delete their keys in that order. */}
      <div className="grid max-w-[46rem] gap-6">
        <div>
          <p className="mb-4 text-dim">To update, run the install command again.</p>
          <Terminal title="update">{INSTALL_COMMAND}</Terminal>
        </div>
        <div>
          <p className="mb-4 text-dim">
            Old versions stay where they are, so going back to one is a link flip and not another
            download.
          </p>
          <Terminal title="go back">
            {'ln -sf ~/.tula/versions/<version>/tula ~/.tula/bin/tula'}
          </Terminal>
        </div>
        <div>
          <p className="mb-4 text-dim">
            To remove tula, delete both folders — the second one holds the keys you saved — and the
            line the installer added to your shell profile.
          </p>
          <Terminal title="remove">{'rm -rf ~/.tula ~/.config/tula'}</Terminal>
        </div>
      </div>
    </main>
  )
}
