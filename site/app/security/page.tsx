import type { Metadata } from 'next'
import Link from 'next/link'
import { Nav } from '@/components/Nav'
import { REPO } from '@/lib/site'

export const metadata: Metadata = {
  title: 'tula security model',
  description: 'What tula promises about your credentials and your funds, and what enforces each.',
}

const PROMISES = [
  ['No code path can place an order or move funds', 'guard.sh fails CI if one appears'],
  ['It never handles key material', 'the same guard fails on any key or seed identifier'],
  [
    'Credentials never reach model context',
    'the agent layer cannot import a connector or the store',
  ],
  ['An over-scoped key is refused, not warned about', 'checked against the venue at connect time'],
  ['Credentials stay on your machine', 'mode 600, verified on every read'],
  ['A price-source key is typed in the shell', 'never on a command line a history would keep'],
] as const

const NOTES = [
  [
    'Never a seed phrase',
    'On-chain reads take a public address. No field accepts a private key. Anything asking you for a seed phrase is not tula.',
  ],
  [
    'Unknown is a value',
    'Kraken cannot prove what a key may do without placing an order, so it reads unknown. A missing price yields no notional, never a zero.',
  ],
  [
    'The model never computes',
    'Every figure arrives from deterministic code, already rounded. The model queries one interface and cannot reach a venue or the credential store.',
  ],
  [
    'The install path is checked',
    'The installer verifies a checksum and a sigstore attestation proving this repo built the binary. It refuses rather than warns.',
  ],
  [
    'On-chain text is hostile',
    'Token names, memos and protocol descriptions are attacker-controlled. They are data, never instructions.',
  ],
  [
    'Network egress',
    'The venues you connect, the price source, the token list. Anthropic only when you ask a question \u2014 computed figures, never a credential. No telemetry.',
  ],
] as const

export default function Page() {
  return (
    <>
      <Nav current="/security" />
      <main className="wrap py-16">
        <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium tracking-[-0.025em]">
          Security model
        </h1>
        <p className="mb-8 max-w-[42rem] text-[1.08rem] text-dim">
          Read-only and non-custodial. That removes theft, not data risk: it builds one view of an
          entire cross-venue net worth.
        </p>

        <div className="mb-14 max-w-[46rem] rounded-r border border-l-2 border-rule border-l-accent-dim bg-panel px-5 py-4">
          <p>
            <strong className="font-semibold text-white">This page is canonical.</strong> tula comes
            from <a href={REPO}>github.com/hsnice16/tula</a> and{' '}
            <Link href="/install">its install page</Link>, nowhere else. Anything{' '}
            <code className="font-mono text-[0.86rem] text-notice">gh attestation verify</code>{' '}
            rejects did not come from this project.
          </p>
        </div>

        <p className="label mb-6">
          <span className="text-accent-dim">01</span> Promises, and what enforces them
        </p>
        <dl className="mb-16 max-w-[52rem]">
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
          Report a vulnerability in <a href={`${REPO}/blob/main/SECURITY.md`}>SECURITY.md</a>. Not
          as a public issue.
        </p>
      </main>
    </>
  )
}
