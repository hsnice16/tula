import type { Metadata } from 'next'
import { Ext } from '@/components/Ext'
import { breadcrumb, JsonLd } from '@/components/JsonLd'
import { Link } from '@/components/Link'
import { NAME, OG, REPO, TWITTER } from '@/lib/site'

const TITLE = 'Security model — non-custodial, and read-only'
const SUMMARY =
  'What tula promises about your keys and your funds, and what enforces each promise. No code path can move funds off a venue, and your keys never reach the model.'

export const metadata: Metadata = {
  title: TITLE,
  description: SUMMARY,
  alternates: { canonical: '/security' },
  openGraph: {
    ...OG,
    type: 'website',
    url: '/security',
    title: `${TITLE} · ${NAME}`,
    description: SUMMARY,
  },
  twitter: { ...TWITTER, title: `${TITLE} · ${NAME}`, description: SUMMARY },
}

const PROMISES = [
  ['No code path can move funds off a venue', 'no endpoint that moves funds, in any connector'],
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
    'On-chain, a public address is all tula needs. No screen asks for a seed phrase. The only private key it loads is a Coinbase CDP key, used only to read.',
  ],
  [
    'Not encrypted at rest',
    'Your keys sit in one plain file only you can read (mode 600). Other users on the machine cannot open it; a backup or software running as you can.',
  ],
  [
    'What you type',
    'Lines you send are saved with the same protection, so ↑ reaches past sessions. Keys, seed phrases, connect screens and lines starting with a space are never saved. TULA_NO_HISTORY=1 keeps nothing.',
  ],
  [
    'Unknown is a value',
    'Stripe publishes no way to check what a key can do, so tula says unknown rather than safe. A missing price shows as missing, never as zero.',
  ],
  [
    'The model never computes',
    'Every number is worked out in code first. The model only reads the results; it cannot reach a venue or your keys.',
  ],
  [
    'The install is checked',
    'The installer stops if the checksum does not match. With the GitHub CLI signed in, it also checks who built the binary; without it, it says that was not proven.',
  ],
  [
    'Text tula did not write',
    'Some text comes from outside tula: a Hyperliquid builder dex name, a token name as the configured token list names it or as an Aave reserve contract returns it, and errors from a venue or a price source or the model provider. All of it is cut short and cleaned before it reaches the screen or the model.',
  ],
  [
    'What tula connects to',
    'The venues you connect, your price source, token lists, and public nodes for Ethereum, Arbitrum One, Base, Polygon, Optimism, Avalanche, Gnosis, Scroll and Linea. If a node is down tula tries the next one, which then also sees your address. Anthropic gets only finished numbers, and only when you ask a question. The shell checks GitHub for a new release each time it opens. The binary tracks nothing; this site uses Google Analytics and shows a Peerlist badge.',
  ],
] as const

export default function Page() {
  return (
    <main className="wrap pt-16 pb-step-3">
      <JsonLd schema={breadcrumb('Security', '/security')} />
      <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium leading-[1.1] tracking-[-0.025em]">
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

      <div className="mb-step-3 max-w-[46rem] rounded-r border border-l-2 border-rule border-l-accent-dim bg-panel px-5 py-4 shadow-lift">
        <p>
          <strong className="font-semibold text-white">Every copy comes from here.</strong> tula is
          built from{' '}
          <Ext href={REPO} className="[overflow-wrap:anywhere]">
            github.com/hsnice16/tula
          </Ext>{' '}
          and published on <Link href="/install">its install page</Link>, Homebrew and npm — the
          same binary everywhere.
        </p>
      </div>

      <h2 className="label mb-8">Promises, and what enforces them</h2>
      <dl className="mb-step-3 max-w-[52rem]">
        {PROMISES.map(([promise, enforced]) => (
          <div
            key={promise}
            className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-rule-soft py-3.5 last:border-b-0"
          >
            <dt className="text-ink">{promise}</dt>
            <dd className="font-mono text-[0.78rem] text-dim">{enforced}</dd>
          </div>
        ))}
      </dl>

      <h2 className="label mb-8">Limits</h2>
      <div className="grid gap-px overflow-hidden rounded border border-rule bg-rule [overflow-wrap:anywhere] md:grid-cols-2">
        {NOTES.map(([title, body], i) => (
          // An odd count leaves a visible empty cell; the last one takes the row.
          <div
            key={title}
            className={`bg-bg px-5 py-5 ${i === NOTES.length - 1 && NOTES.length % 2 ? 'md:col-span-2' : ''}`}
          >
            <h3 className="mb-2 text-[0.95rem] font-semibold text-ink">{title}</h3>
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
