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
  'Install tula on macOS or Linux with one command. Every release carries a published checksum and a sigstore-backed build attestation, and the installer stops on a download that does not match. Also on Homebrew and npm.'

export const metadata: Metadata = {
  title: TITLE,
  description: SUMMARY,
  alternates: { canonical: '/install' },
  openGraph: { ...OG, type: 'website', url: '/install', title: TITLE, description: SUMMARY },
  twitter: { ...TWITTER, title: `${TITLE} · ${NAME}`, description: SUMMARY },
}

const CHECKS = [
  ['Published checksum', 'Always. The install stops if the download does not match it.'],
  [
    'Build attestation',
    'GitHub signs it as the release is built. Checking it needs the GitHub CLI, which most people do not have — read the section below before you count on it.',
  ],
  [
    'Versioned installs',
    'Every release keeps a name of its own, so an older build is still there after a newer one arrives.',
  ],
] as const

/**
 * "Not found" is one message with three different causes, and the section sits
 * below the tabs where a reader of any channel lands on it. It used to answer
 * for the install script alone — which is not the channel that leaves a binary
 * unreachable on purpose. Homebrew is: a pinned formula is `keg_only`.
 */
const PATH_FIXES: [string, ReactNode][] = [
  [
    'Install script',
    <>
      Near the end it printed one of three. <Code>added to</Code> or <Code>already in</Code> means
      the PATH line is in a profile already, and this shell started before it — open a new one.{' '}
      <Code>add it yourself</Code> means it changed nothing, and the <Code>export</Code> line beside
      it is yours to add.
    </>,
  ],
  [
    'Homebrew',
    <>
      A pinned <Code>tula@&lt;version&gt;</Code> is <Code>keg_only</Code>, so it is installed and
      deliberately not on your PATH until you <Code>brew link</Code> it.
    </>,
  ],
  [
    'npm',
    <>
      Its launcher goes to npm&rsquo;s global bin directory, which has to be on your PATH.{' '}
      <Code>npm prefix -g</Code> names the folder that <Code>bin</Code> sits in.
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
  ['macOS', 'Yes', 'Intel and ARM, 64-bit.'],
  ['Linux', 'Yes', 'Intel and ARM, 64-bit. Needs glibc.'],
  ['Alpine, or any musl Linux', 'No', 'The installer says so and stops.'],
  ['Windows', 'Through WSL', 'Install inside WSL, where it is Linux. There is no native build.'],
] as const

/** A step within one channel's panel, under the h1 the page opens with. */
function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="mb-2.5 text-[0.95rem] font-semibold text-ink">{title}</h2>
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
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-7 gap-y-1.5 text-[0.82rem]">
          {FLAGS.map(([flag, why]) => (
            <div key={flag} className="contents">
              <dt className="font-mono text-notice">{flag}</dt>
              <dd className="text-faint">{why}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 mb-6 text-[0.9rem] text-faint">
          This pipes a script into your shell, so read it before you run it.{' '}
          <Ext href={`${SITE}/install.sh`}>install.sh</Ext> is the file the command fetches, copied
          from <Ext href={`${REPO}/blob/main/install.sh`}>the one in the repo</Ext> — the same file,
          and the one every test runs against.
        </p>
        <Aside>
          tula checks for a new release once a day and says so in a line. It never installs one
          without asking: <Code>/update</Code> shows what it would install and where to check it,
          and <Code>/update install</Code> is the step that goes ahead.
        </Aside>

        <Step title="Where it puts things">
          <p className="mb-4 text-dim">
            Everything goes under <Code>~/.tula</Code>. Each version gets its own folder, and{' '}
            <Code>~/.tula/bin/tula</Code> is a link pointing at the one you run.
          </p>
          <p className="text-dim">
            If <Code>~/.tula/bin</Code> is not on your PATH, the installer adds a line to your zsh,
            bash or fish profile and tells you which file it changed. On any other shell it prints
            the line and changes nothing. Set <Code>TULA_NO_MODIFY_PATH=1</Code> to make it print
            rather than edit, whatever your shell.
          </p>
        </Step>

        <Step title="One exact version">
          <p className="text-dim">
            Set <Code>TULA_VERSION</Code> to install a version instead of the newest. It also takes{' '}
            <Code>latest</Code>, which is what you get anyway. In CI, add{' '}
            <Code>TULA_REQUIRE_ATTESTATION=1</Code> to stop the install when the build attestation
            cannot be checked, rather than warn about it.
          </p>
        </Step>

        <Step title="Update">
          <p className="mb-4 text-dim">
            <Code>/update install</Code> from inside tula does this without leaving it. Running the
            command again does the same thing, and is the one that still works when tula will not
            start.
          </p>
          <Terminal title="update">{INSTALL_COMMAND}</Terminal>
        </Step>

        <Step title="Go back">
          <p className="mb-4 text-dim">
            Old versions stay on disk, so going back is a change of link rather than another
            download.
          </p>
          <Command label="go back">
            {'ln -sf ~/.tula/versions/<version>/tula ~/.tula/bin/tula'}
          </Command>
        </Step>

        <Step title="Remove">
          <p className="mb-4 text-dim">
            Delete the folder, and the line the installer added to your shell profile. Your keys are
            kept elsewhere, so this leaves them alone.
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
          That names the tap and the formula together, which is the only way to do it in one
          command. To type the short name instead, tap once with <Code>brew tap hsnice16/tap</Code>{' '}
          and <Code>brew install tula</Code> works on that machine from then on.
        </p>
        <p className="mt-4 text-dim">
          Homebrew downloads the archive from the same GitHub release the install script uses, and
          checks it against the checksum written into the formula. It keeps the binary in its own
          prefix, not under <Code>~/.tula</Code>.
        </p>
        <p className="mt-4 mb-6 text-dim">
          There are two names to install from. <Code>tula</Code> moves only when a release is
          promoted to it, so a build found to be wrong is skipped by not promoting the next one.{' '}
          <Code>tula-latest</Code> takes every release, pre-releases included.
        </p>
        <Aside>
          tula checks for a new release once a day and says so in a line. It never installs one
          without asking, and on Homebrew it does not install one at all — that is{' '}
          <Code>brew upgrade tula</Code>, so brew is never left naming a version that is not
          running.
        </Aside>

        <Step title="One exact version">
          <p className="mb-4 text-dim">
            Every release also gets a formula of its own, and the tap keeps them. A pinned formula
            is <Code>keg_only</Code>: installing it does not put it on your PATH, so linking it is
            the step that says which tula you mean.
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
          <p className="text-dim">
            Install and link a pinned formula from above. A Homebrew formula holds one version, so
            those pinned names are what makes an older build reachable at all.
          </p>
        </Step>

        <Step title="Remove">
          <p className="mb-4 text-dim">
            That leaves the tap behind, which is a few lines of text and nothing else.{' '}
            <Code>brew untap hsnice16/tap</Code> drops it too.
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
            repackages the release instead of serving it, so the GitHub attestation the other two
            channels carry does not cover this tarball. It is published with npm's own sigstore
            provenance instead — <Code>npm audit signatures</Code> checks it, and npmjs.com shows
            which workflow and commit built it. What npm's integrity hash proves is only that the
            file arrived intact, which is a different question again.
          </Aside>
        </div>
        <p className="mb-6 text-dim">
          You need Node to install it. You do not need Node to run it: the package carries the same
          binary as the other channels and puts it in place of its own launcher. It does not install
          under <Code>~/.tula</Code>.
        </p>
        <Aside>
          tula checks for a new release once a day and says so in a line. It never installs one
          without asking, and on npm it does not install one at all — that is{' '}
          <Code>npm update</Code>, so npm is never left naming a version that is not running.
        </Aside>

        <Step title="One exact version">
          <p className="mb-4 text-dim">
            npm keeps every version it has published, so naming one is all it takes. It is not a
            pin, though: <Code>npm update</Code> moves you off it to the newest release, however far
            away that is.
          </p>
          <Command label="npm, one version">{'npm install -g @hsnice16/tula@<version>'}</Command>
        </Step>

        <Step title="Update">
          <p className="mb-4 text-dim">Installing again without a version does the same thing.</p>
          <Command label="update">{'npm update -g @hsnice16/tula'}</Command>
        </Step>

        <Step title="Go back">
          <p className="text-dim">
            Name the older version, the same command as above. npm keeps what it has published, so
            an old build is a download rather than something you needed to have kept.
          </p>
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
      <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium tracking-[-0.025em]">
        Install
      </h1>
      <p className="mb-10 max-w-[36rem] text-[1.05rem] text-dim">
        One file, and nothing else to install beside it. Three ways to get it, and the same binary
        at the end of all of them.
      </p>

      <Channels channels={CHANNELS} />

      <p className="label mt-step-3 mb-8">Confirm it worked</p>
      <div className="mb-step-3 max-w-[46rem]">
        <Command label="confirm">{'tula --version'}</Command>
        <p className="mt-4 text-dim">
          It prints the version. If your shell says it cannot find tula, it is on disk and your PATH
          does not reach it — which line fixes that is the one thing the three channels do not
          share.
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

      <p className="label mb-8">Proving who built it</p>
      <div className="mb-step-3 max-w-[46rem]">
        <p className="mb-4 text-dim">
          A checksum proves the file arrived whole. It does not prove who made it: the checksum is
          published beside the file, so whoever could swap one could swap the other. The build
          attestation is the part that proves origin — GitHub signs it as the release is built, and
          nobody who gets hold of the files afterwards can reissue it.
        </p>
        <p className="mb-6 text-dim">
          Checking one needs the GitHub CLI, signed in with <Code>gh auth login</Code>. It will not
          fetch an attestation without a token, even for a public repository.
        </p>
        <div className="mb-6">
          <Aside warn>
            Most people do not have the GitHub CLI, and nothing here requires it. Without it you
            still get an HTTPS-only download and a checksum the installer will not skip — but
            nothing has proved who built the binary, and the installer says so in as many words when
            it finishes.
          </Aside>
        </div>
        <Terminal title="verify">
          {
            "curl --proto '=https' --tlsv1.2 -fLO https://github.com/hsnice16/tula/releases/download/v0.1.0/tula-v0.1.0-darwin-arm64.tar.gz\ngh attestation verify tula-v0.1.0-darwin-arm64.tar.gz --repo hsnice16/tula"
          }
        </Terminal>
        <p className="mt-4 text-dim">
          The download is the first step, not a repeat of one: the attestation covers the archive
          rather than the binary inside it, and the installer keeps no copy of the archive.
        </p>
      </div>

      <p className="label mb-8">Your keys are kept apart</p>
      <div className="max-w-[46rem]">
        <p className="mb-4 text-dim">
          Whichever way you installed it, what you save lives in <Code>~/.config/tula</Code>, away
          from the binary. Reinstalling does not touch it, updating does not touch it, and removing
          tula leaves it where it is.
        </p>
        <p className="mb-4 text-dim">
          So deleting it is a separate step, and a deliberate one. Run this when you are done with
          tula, not when you are reinstalling it.
        </p>
        <Command label="remove your keys">{'rm -rf ~/.config/tula'}</Command>
      </div>
    </main>
  )
}
