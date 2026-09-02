import type { Metadata } from 'next'
import { Ext } from '@/components/Ext'
import { Link } from '@/components/Link'
import { REPO } from '@/lib/site'

export const metadata: Metadata = {
  title: 'tula security model',
  description: 'What tula promises about your credentials and your funds, and what enforces each.',
}

const PROMISES = [
  [
    'No code path can move funds off a venue',
    'no withdrawal or transfer endpoint, in any connector',
  ],
  ['Nothing places an order, for the moment', 'the build fails if an order endpoint appears'],
  [
    'A key that can move funds is refused, not warned about',
    'checked against the venue at connect time',
  ],
  [
    'Credentials never reach model context',
    'the agent layer cannot import a connector or the store',
  ],
  [
    'Credentials stay on your machine, in one file',
    'mode 600, and refused if anything else can reach it',
  ],
  ['A price-source key is typed in the shell', 'never on a command line a history would keep'],
] as const

const NOTES = [
  [
    'Never a seed phrase',
    'On-chain reads take a public address. No field asks for a seed phrase, and anything that does is not tula. The one private key it loads is a Coinbase CDP key, which signs read requests and cannot move funds \u2014 the build fails if key handling appears in any other file.',
  ],
  [
    'Not encrypted at rest',
    'Credentials are plain JSON in one file, mode 600. A key kept beside the ciphertext would protect nothing, and a passphrase would break the commands that run unattended. So: safe from others on the machine, not from a backup or from anything already running as you.',
  ],
  [
    'Unknown is a value',
    'Kraken cannot prove what a key may do without placing an order, so it reads unknown rather than safe. A missing price yields no notional, never a zero. A key that can trade is refused today too; the refusal that will never relax is withdraw.',
  ],
  [
    'The model never computes',
    'Every figure arrives from deterministic code, already rounded. The model queries one interface and cannot reach a venue or the credential store.',
  ],
  [
    'The install path is checked',
    'The installer refuses a download whose published checksum does not match. Where the GitHub CLI is present it also verifies a sigstore attestation and refuses on failure; where it is not, it says plainly that provenance was not proven. TULA_REQUIRE_ATTESTATION makes that a refusal too.',
  ],
  [
    'Text tula did not write',
    'Two kinds of string reach the screen and the model from outside: an asset symbol \u2014 as a venue\u2019s listing spells it, or as an Aave reserve contract returns it \u2014 and a venue\u2019s own error text when one fails. Both are capped and flattened to a single line on the way in, so neither can pose as an instruction. No memo, NFT metadata or protocol description is read at all.',
  ],
  [
    'Network egress',
    'The venues you connect, a public Ethereum RPC, the price source, the token list. Anthropic only when you ask a question \u2014 computed figures, never a credential. No telemetry.',
  ],
] as const

export default function Page() {
  return (
    <main className="wrap pt-16 pb-54">
      <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium tracking-[-0.025em]">
        Security model
      </h1>
      {/* Two paragraphs: run together, the second sentence starts mid-line. */}
      <p className="mb-3 max-w-[42rem] text-[1.08rem] text-dim">
        Non-custodial, and read-only for the moment — placing trades will come later.
      </p>
      <p className="mb-8 max-w-[42rem] text-[1.08rem] text-dim">
        That removes theft of your funds, not risk to your data: one file on your machine holds a
        key to every venue you connect, and it is not encrypted at rest.
      </p>

      {/* mb-54 and the labels' mb-8 are the overview's rhythm, measured: 216px
          above a section label, 32px under. That page composes the 216 from a
          pb-36 and the next pt-18; this page is one block, so it states it. */}
      <div className="mb-54 max-w-[46rem] rounded-r border border-l-2 border-rule border-l-accent-dim bg-panel px-5 py-4 shadow-lift">
        <p>
          <strong className="font-semibold text-white">Every copy comes from here.</strong> tula is
          built by <Ext href={REPO}>github.com/hsnice16/tula</Ext> and published to{' '}
          <Link href="/install">its install page</Link>, Homebrew and npm — one binary, built once.
          The release archive carries the attestation, so that is what{' '}
          <code className="font-mono text-[0.86rem] text-notice">gh attestation verify</code> reads;
          npm repackages the same binary and cannot be checked that way. An archive it rejects did
          not come from this project.
        </p>
      </div>

      <p className="label mb-8">
        <span className="text-accent-dim">01</span> Promises, and what enforces them
      </p>
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

      <p className="label mb-8">
        <span className="text-accent-dim">02</span> Where the edges are
      </p>
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
        How to report a vulnerability is in{' '}
        <Ext href={`${REPO}/blob/main/SECURITY.md`}>SECURITY.md</Ext>. Privately, not as a public
        issue.
      </p>
    </main>
  )
}
