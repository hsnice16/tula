import type { Metadata } from 'next'
import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { breadcrumb, JsonLd } from '@/components/JsonLd'
import { Link } from '@/components/Link'
import { NAME, OG, REPO, TWITTER } from '@/lib/site'

const TITLE = 'Security model — non-custodial, and read-only'
const SUMMARY =
  'What tula promises about your credentials and your funds, and what enforces each in the build: no code path can move funds off a venue, a key that can withdraw is refused rather than warned about, and your keys never reach the model.'

export const metadata: Metadata = {
  title: TITLE,
  description: SUMMARY,
  alternates: { canonical: '/security' },
  openGraph: { ...OG, type: 'website', url: '/security', title: TITLE, description: SUMMARY },
  twitter: { ...TWITTER, title: `${TITLE} · ${NAME}`, description: SUMMARY },
}

const PROMISES = [
  [
    'No code path can move funds off a venue',
    'no withdrawal or transfer endpoint, in any connector',
  ],
  ['Nothing places an order, for the moment', 'the build fails if an order endpoint appears'],
  [
    'A key that can move funds is turned away, not warned about',
    'checked against the venue at connect time',
  ],
  ['Your keys never reach the model', 'the agent layer cannot import a connector or the store'],
  [
    'Your keys stay on your machine, in one file',
    'mode 600, and refused if anything else can reach it',
  ],
  ['A price-source key is typed into a prompt', 'never on a command line your history would keep'],
] as const

const NOTES = [
  [
    'Never a seed phrase',
    'Reading on-chain takes a public address, nothing more. No box on any screen asks for a seed phrase, and anything that does is not tula. The one private key it ever loads is a Coinbase CDP key, which signs read requests and cannot move funds \u2014 the build fails if key handling shows up in any other file.',
  ],
  [
    'Not encrypted at rest',
    'Your keys are plain JSON in one file, mode 600. Locking it would mean keeping the key to the lock right beside it, which protects nothing, or asking you for a passphrase, which breaks any command that runs on its own. So: safe from other people on the machine, not from a backup or from anything already running as you.',
  ],
  [
    'Unknown is a value',
    'Kraken cannot tell what a key is allowed to do without placing an order, so tula says unknown rather than safe. A missing price means no value shown, never a zero. A key that can trade is turned away today as well; the one that will never be let through is withdraw.',
  ],
  [
    'The model never computes',
    'Every number on screen is worked out in plain code and rounded before the model sees it. The model asks one interface for answers, and cannot reach a venue or your keys.',
  ],
  [
    'The install path is checked',
    'The installer stops if the published checksum does not match. Where the GitHub CLI is present and signed in it also checks a sigstore attestation and stops if that fails; where it is not, it says plainly that provenance was not proven. TULA_REQUIRE_ATTESTATION=1 makes that a refusal too.',
  ],
  [
    'Text tula did not write',
    'Two kinds of text reach the screen and the model from outside: an asset symbol \u2014 as a venue\u2019s listing spells it, or as an Aave reserve contract returns it \u2014 and a venue\u2019s own error text when one fails. Both are cut to a length limit and squashed onto one line on the way in, so neither can pose as an instruction. No memo, NFT metadata or protocol description is read at all.',
  ],
  [
    'Network egress',
    'The venues you connect, a public Ethereum RPC, the price source, the token list. Anthropic only when you ask a question, and only the numbers already worked out \u2014 never a key. Nothing is sent about how you use it.',
  ],
] as const

export default function Page() {
  return (
    <main className="wrap pt-16 pb-54">
      <JsonLd schema={breadcrumb('Security', '/security')} />
      <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium tracking-[-0.025em]">
        Security model
      </h1>
      {/* Two paragraphs: run together, the second sentence starts mid-line. */}
      <p className="mb-3 max-w-[42rem] text-[1.08rem] text-dim">
        Non-custodial, and read-only for the moment — placing trades will come later.
      </p>
      <p className="mb-8 max-w-[42rem] text-[1.08rem] text-dim">
        That rules out losing your funds. It does not rule out losing your data: one file on your
        machine holds a key to every venue you connect.
      </p>

      <div className="mb-54 max-w-[46rem] rounded-r border border-l-2 border-rule border-l-accent-dim bg-panel px-5 py-4 shadow-lift">
        <p>
          <strong className="font-semibold text-white">Every copy comes from here.</strong> tula is
          built by <Ext href={REPO}>github.com/hsnice16/tula</Ext> and published to{' '}
          <Link href="/install">its install page</Link>, Homebrew and npm — one binary, built once.
          The attestation covers the release archive, so that is what{' '}
          <Code>gh attestation verify</Code> reads; npm repacks the same binary and cannot be
          checked that way. An archive it turns down did not come from this project.
        </p>
      </div>

      <p className="label mb-8">Promises, and what enforces them</p>
      <dl className="mb-54 max-w-[52rem]">
        {PROMISES.map(([promise, enforced]) => (
          <div
            key={promise}
            className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-rule-soft py-3.5 last:border-b-0"
          >
            <dt className="text-ink">{promise}</dt>
            <dd className="font-mono text-[0.78rem] text-faint">{enforced}</dd>
          </div>
        ))}
      </dl>

      <p className="label mb-8">Where the edges are</p>
      <div className="grid gap-px overflow-hidden rounded border border-rule bg-rule md:grid-cols-2">
        {NOTES.map(([title, body], i) => (
          // An odd count leaves a visible empty cell; the last one takes the row.
          <div
            key={title}
            className={`bg-bg px-5 py-5 ${i === NOTES.length - 1 && NOTES.length % 2 ? 'md:col-span-2' : ''}`}
          >
            <h2 className="mb-2 text-[0.95rem] font-semibold text-ink">{title}</h2>
            <p className="text-[0.88rem] leading-relaxed text-dim">{body}</p>
          </div>
        ))}
      </div>

      <p className="mt-10 text-dim">
        Found a hole? Report it privately, never as a public issue.{' '}
        <Ext href={`${REPO}/blob/main/SECURITY.md`}>SECURITY.md</Ext> says how to send it, what
        counts as in scope, and how long a reply takes.
      </p>
    </main>
  )
}
