import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Aside } from '@/components/Aside'
import { type Channel, Channels } from '@/components/Channels'
import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { breadcrumb, JsonLd } from '@/components/JsonLd'
import { Command, Terminal } from '@/components/Terminal'
import { INSTALL_COMMAND, NAME, OG, REPO, SITE, TWITTER } from '@/lib/site'

const TITLE = 'Install — one command, and every download checked'
const SUMMARY =
  'Install tula on macOS or Linux with one command. Every download is checked, and the installer stops on one that does not match. Also on Homebrew and npm.'

export const metadata: Metadata = {
  title: TITLE,
  description: SUMMARY,
  alternates: { canonical: '/install' },
  openGraph: {
    ...OG,
    type: 'website',
    url: '/install',
    title: `${TITLE} · ${NAME}`,
    description: SUMMARY,
  },
  twitter: { ...TWITTER, title: `${TITLE} · ${NAME}`, description: SUMMARY },
}

const CHECKS = [
  ['Checksum', 'Always checked. The install stops if it does not match.'],
  [
    'Build attestation',
    'GitHub signs each release as it is built. Checking it needs the GitHub CLI.',
  ],
  ['Versioned installs', 'Every release stays installable, so you can always go back.'],
] as const

/**
 * "Not found" is one message with three different causes, and the section sits
 * below the tabs where a reader of any channel lands on it. Answering for the
 * install script alone misses the channel that leaves a binary unreachable on
 * purpose: Homebrew, where a pinned formula is `keg_only`.
 */
const PATH_FIXES: [string, ReactNode][] = [
  [
    'Install script',
    <>
      If it printed <Code>added to</Code> or <Code>already in</Code>, open a new terminal. If it
      printed <Code>add it yourself</Code>, add the <Code>export</Code> line it showed.
    </>,
  ],
  [
    'Homebrew',
    <>
      A pinned <Code>tula@&lt;version&gt;</Code> is <Code>keg_only</Code>. Run{' '}
      <Code>brew link</Code> on it.
    </>,
  ],
  [
    'npm',
    <>
      npm&rsquo;s global bin folder must be on your PATH. <Code>npm prefix -g</Code> shows the
      folder that holds it.
    </>,
  ],
]

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
  ['macOS 13 or later', 'Yes', 'Intel and ARM, 64-bit.'],
  ['Linux', 'Yes', 'Intel and ARM, 64-bit. Needs glibc.'],
  ['Alpine, or any musl Linux', 'No', 'The installer says so and stops.'],
  ['Windows', 'Through WSL', 'Install inside WSL. There is no native build.'],
] as const

/** A step within one channel's panel, under that panel's own heading. */
function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-8">
      <h3 className="mb-2.5 text-[0.95rem] font-semibold text-ink">{title}</h3>
      {children}
    </div>
  )
}

/**
 * Every channel says how updates arrive in the same place, and all three carry
 * the same promise word for word. A tool that both watches for releases and can
 * replace its own binary is one people are right to want that promise from, and
 * it is worth more repeated in each tab than made once in a tab they never
 * opened. `site-claims.test.ts` counts the three.
 */
const CHANNELS: Channel[] = [
  {
    name: 'Install script',
    note: '(recommended)',
    body: (
      <>
        <Terminal title="install">{INSTALL_COMMAND}</Terminal>
        {/* A legend for the command directly above, so it sits tight under it —
            justified across the full column reads as two unrelated lists. */}
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-7 gap-y-1.5 text-[0.82rem] [overflow-wrap:anywhere]">
          {FLAGS.map(([flag, why]) => (
            <div key={flag} className="contents">
              <dt className="font-mono text-notice">{flag}</dt>
              <dd className="text-dim">{why}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 mb-6 text-[0.9rem] text-dim">
          It runs a script in your shell, so read <Ext href={`${SITE}/install.sh`}>install.sh</Ext>{' '}
          first. It is the same file as{' '}
          <Ext href={`${REPO}/blob/main/install.sh`}>the one in the repo</Ext>.
        </p>
        <Aside>
          The tula shell checks for a new release each time it opens. It never installs one without
          asking: run <Code>/update install</Code>.
        </Aside>

        <Step title="Where it puts things">
          <p className="mb-4 text-dim">
            Everything goes in <Code>~/.tula</Code>, one folder per version. It will not use a
            folder other users can write to. <Code>TULA_INSTALL_DIR</Code> picks another folder.
          </p>
          <p className="text-dim">
            If <Code>~/.tula/bin</Code> is not on your PATH, it adds it to your zsh, bash or fish
            profile. <Code>TULA_NO_MODIFY_PATH=1</Code> prints the line instead.
          </p>
        </Step>

        <Step title="One exact version">
          <p className="text-dim">
            Set <Code>TULA_VERSION</Code> to pick a version. In CI,{' '}
            <Code>TULA_REQUIRE_ATTESTATION=1</Code> stops the install if who built it cannot be
            checked.
          </p>
        </Step>

        <Step title="Update">
          <p className="mb-4 text-dim">
            Run <Code>/update install</Code> in tula, or the install command again — that works even
            if tula will not start. A version you already have is not downloaded twice;{' '}
            <Code>TULA_FORCE=1</Code> downloads it anyway.
          </p>
          <Terminal title="update">{INSTALL_COMMAND}</Terminal>
        </Step>

        <Step title="Go back">
          <p className="mb-4 text-dim">Old versions stay on disk, so going back is one link:</p>
          <Command label="go back">
            {'ln -sf ~/.tula/versions/<version>/tula ~/.tula/bin/tula'}
          </Command>
        </Step>

        <Step title="Remove">
          <p className="mb-4 text-dim">
            Delete the folder and the PATH line in your profile. Your keys are kept elsewhere.
          </p>
          <Command label="remove">{'rm -rf ~/.tula'}</Command>
        </Step>
      </>
    ),
  },
  {
    name: 'Homebrew',
    body: (
      <>
        <Terminal title="homebrew">{'brew install hsnice16/tap/tula'}</Terminal>
        <p className="mt-5 text-dim">
          Or run <Code>brew tap hsnice16/tap</Code> once, then <Code>brew install tula</Code>.
        </p>
        <p className="mt-4 text-dim">
          Homebrew checks the download against the checksum in the formula.
        </p>
        <p className="mt-4 mb-6 text-dim">
          <Code>tula</Code> gets stable releases; <Code>tula-latest</Code> gets every release.
        </p>
        <Aside>
          The tula shell checks for a new release each time it opens. It never installs one without
          asking, and on Homebrew it does not install one at all: run <Code>brew upgrade tula</Code>
          .
        </Aside>

        <Step title="One exact version">
          <p className="mb-4 text-dim">
            Every release has a pinned formula. It is <Code>keg_only</Code>, so link it to use it:
          </p>
          <Terminal title="homebrew, one version">
            {
              'brew install hsnice16/tap/tula@<version>\nbrew link --overwrite --force tula@<version>'
            }
          </Terminal>
        </Step>

        <Step title="Update">
          <Command label="update">{'brew upgrade tula'}</Command>
        </Step>

        <Step title="Go back">
          <p className="text-dim">Install and link an older pinned formula, as above.</p>
        </Step>

        <Step title="Remove">
          <p className="mb-4 text-dim">
            <Code>brew untap hsnice16/tap</Code> also removes the tap.
          </p>
          <Command label="remove">{'brew uninstall tula'}</Command>
        </Step>
      </>
    ),
  },
  {
    name: 'npm',
    body: (
      <>
        <Terminal title="npm">{'npm install -g @hsnice16/tula'}</Terminal>
        {/* The one channel whose proof is a different check from the one the rest
            of this page teaches, said where somebody choosing it will read it
            rather than in shared prose they have already scrolled past. Not
            `warn`: there is nothing here the reader would assume they had and
            do not — the provenance is real, and it is the command that differs. */}
        <div className="mt-5 mb-6">
          <Aside>
            <strong className="font-semibold text-ink">Checked a different way.</strong> npm
            repackages the binary, so the GitHub attestation does not cover it. Check npm&rsquo;s
            own provenance with <Code>npm audit signatures</Code>.
          </Aside>
        </div>
        <p className="mb-6 text-dim">Node is needed to install it, not to run it.</p>
        <Aside>
          The tula shell checks for a new release each time it opens. It never installs one without
          asking, and on npm it does not install one at all: run the update below.
        </Aside>

        <Step title="One exact version">
          <p className="mb-4 text-dim">
            Name the version. Installing without one moves you back to the newest.
          </p>
          <Command label="npm, one version">{'npm install -g @hsnice16/tula@<version>'}</Command>
        </Step>

        <Step title="Update">
          <Command label="update">{'npm install -g @hsnice16/tula'}</Command>
        </Step>

        <Step title="Go back">
          <p className="text-dim">Install the older version, as above.</p>
        </Step>

        <Step title="Remove">
          <Command label="remove">{'npm uninstall -g @hsnice16/tula'}</Command>
        </Step>
      </>
    ),
  },
]

export default function Page() {
  return (
    <main className="wrap pt-16 pb-step-3">
      <JsonLd schema={breadcrumb('Install', '/install')} />
      <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium leading-[1.1] tracking-[-0.025em]">
        Install
      </h1>
      <p className="mb-10 max-w-[36rem] text-[1.05rem] text-dim">
        One file, nothing else to install. Three ways to get it, and the same binary from each.
      </p>

      <Channels channels={CHANNELS} />

      <h2 className="label mt-step-3 mb-8">Confirm it worked</h2>
      <div className="mb-step-3 max-w-[46rem]">
        <Command label="confirm">{'tula --version'}</Command>
        <p className="mt-4 text-dim">
          It prints the version. If your shell cannot find tula, your PATH does not include it:
        </p>
        {/* Rows rather than the three columns the checks above take: the answers
            are uneven, and side by side the longest sets the height of the two
            beside it. */}
        <dl className="mt-5 grid gap-x-7 gap-y-3 text-[0.9rem] sm:grid-cols-[auto_1fr]">
          {PATH_FIXES.map(([channel, fix]) => (
            <div key={channel} className="contents">
              <dt className="font-semibold text-ink">{channel}</dt>
              <dd className="text-dim">{fix}</dd>
            </div>
          ))}
        </dl>
      </div>

      <h2 className="label mb-8">Every install is checked</h2>
      {/* Three columns only where they are wide enough for a sentence. At the
          `sm` these took, the longest ran six lines beside a neighbour of
          three. */}
      <div className="mb-step-3 grid gap-px overflow-hidden rounded border border-rule bg-rule md:grid-cols-3">
        {CHECKS.map(([title, body]) => (
          <div key={title} className="bg-bg px-5 py-5">
            <h3 className="mb-1.5 text-[0.95rem] font-semibold text-ink">{title}</h3>
            <p className="text-[0.88rem] leading-relaxed text-dim">{body}</p>
          </div>
        ))}
      </div>

      <h2 className="label mb-8">What it runs on</h2>
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
                <td className="inline-block text-ink sm:table-cell sm:w-56 sm:border-b sm:border-rule sm:px-5 sm:py-2.5 sm:align-top">
                  {system}
                </td>
                <td className="ml-4 inline-block font-mono text-[0.8rem] text-notice sm:ml-0 sm:table-cell sm:w-40 sm:border-b sm:border-rule sm:px-5 sm:py-2.5 sm:align-top">
                  {works}
                </td>
                <td className="block text-dim sm:table-cell sm:border-b sm:border-rule sm:px-5 sm:py-2.5 sm:align-top">
                  {note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="label mb-8">Proving who built it</h2>
      <div className="mb-step-3 max-w-[46rem]">
        <p className="mb-4 text-dim">
          A checksum proves the file arrived whole, not who made it. The build attestation does:
          GitHub signs it while building the release, and no one can sign it again later.
        </p>
        <p className="mb-6 text-dim">
          Checking it needs the GitHub CLI, signed in with <Code>gh auth login</Code>.
        </p>
        <div className="mb-6">
          <Aside warn>
            Most people do not have the GitHub CLI, and nothing here requires it. You still get an
            HTTPS-only download and a checksum check, just no proof of who built it. The installer
            tells you when that is the case.
          </Aside>
        </div>
        <Terminal title="verify">
          {
            "curl --proto '=https' --tlsv1.2 -fLO https://github.com/hsnice16/tula/releases/download/v0.3.1/tula-v0.3.1-darwin-arm64.tar.gz\ngh attestation verify tula-v0.3.1-darwin-arm64.tar.gz --repo hsnice16/tula --signer-workflow hsnice16/tula/.github/workflows/release.yml"
          }
        </Terminal>
        <p className="mt-4 text-dim">
          The attestation covers the archive, not the binary inside, so this downloads it again.
        </p>
      </div>

      <h2 className="label mb-8">Your keys are kept apart</h2>
      <div className="max-w-[46rem]">
        <p className="mb-4 text-dim">
          Your keys live in <Code>~/.config/tula</Code>. Reinstalling, updating or removing tula
          never touches them.
        </p>
        <p className="mb-4 text-dim">Delete them only when you are done with tula:</p>
        <Command label="remove your keys">{'rm -rf ~/.config/tula'}</Command>
      </div>
    </main>
  )
}
