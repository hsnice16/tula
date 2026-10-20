import { Code } from '@/components/Code'
import { Guide, guideMetadata, Output, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Formula, Points, Terms } from '@/components/Prose'
import { Table } from '@/components/Table'
import { Terminal } from '@/components/Terminal'

const PATH = '/exposure'
const TITLE = 'Net crypto exposure across exchanges and DeFi'
const SUMMARY =
  'What net exposure and net delta mean in crypto, how spot, perps, collateral and debt net into one figure per asset, and how to add it up across venues.'

/** What each kind of holding adds to an asset's net exposure. */
const SIGNS = [
  ['Spot balance', '+ quantity'],
  ['Perp, long', '+ size'],
  ['Perp, short', '− size'],
  ['Lending collateral', '+ quantity'],
  ['Borrowed', '− quantity'],
] as const

/** The front page's book: one asset, three venues. */
const ETH = [
  ['Kraken', 'spot', '+4.00'],
  ['Hyperliquid', 'perp, short', '−2.00'],
  ['Aave', 'collateral', '+4.64'],
  ['Net', '', '6.64 ETH'],
]

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Exposure"
      title={TITLE}
      heading={TITLE}
      description={SUMMARY}
      lead="Hold ETH on an exchange, short it on Hyperliquid and pledge it on Aave, and each venue shows one piece. tula nets them into one figure."
    >
      <Section title="What is net exposure?">
        <p className="mb-4 text-dim">
          How much of an asset you are long or short once every holding is added up: what you gain
          or lose when its price moves. Traders call it net delta. Each holding adds with a sign:
        </p>
        <Terms
          items={SIGNS.map(([holding, sign]) => [holding, <Code key={holding}>{sign}</Code>])}
        />
        <Formula>notional = net quantity × price</Formula>
        <p className="text-dim">
          Gross exposure adds the sizes without signs, and says how much is at work, not which way
          it leans.
        </p>
      </Section>

      <Section title="One figure per asset">
        <p className="mb-4 text-dim">
          <Code>exposure</Code> adds every holding and position in an asset, across venues.
        </p>
        <Output title="tula exposure">
          {`ASSET      NET    NOTIONAL  VENUES                   AS OF
─────  ───────  ──────────  ───────────────────────  ─────────────────
ETH       6.64  $16,268.00  kraken hyperliquid aave  09:14:02 (4s ago)`}
        </Output>
      </Section>

      <Section title="A worked example">
        <Table head={['Venue', 'Held as', 'ETH']} rows={ETH} />
        <p className="mt-4 text-dim">
          At $2,450 that is $16,268.00 of ETH. Gross, the same book holds 10.64 ETH; read venue by
          venue, it looks like three positions rather than one long. <Code>positions ETH</Code>{' '}
          lists the pieces as each venue reports them.
        </p>
      </Section>

      <Section title="What net exposure answers">
        <Terms
          items={[
            [
              'Am I hedged?',
              'Near zero, a price move barely changes what you hold, whatever each venue shows.',
            ],
            [
              'What does a move cost?',
              <>
                Notional × move: a 20% fall on 6.64 ETH is $3,253.60. A{' '}
                <Link href="/stress-test">stress test</Link> runs it on the whole book.
              </>,
            ],
            ['Where is it?', 'The VENUES column names every venue holding a piece.'],
          ]}
        />
      </Section>

      <Section title="Equity">
        <p className="text-dim">
          The total counts a perp at the profit or loss its venue states, never its notional.
          Hyperliquid calls it Account Equity; Bybit, OKX and Deribit call it equity.
        </p>
      </Section>

      <Section title="Kept apart">
        <p className="text-dim">
          A bridge’s token, such as USDC.e on Polygon, is its own asset. It never nets into Circle’s
          USDC. WETH counts as ETH only where it is that chain’s own wrap of ether.
        </p>
      </Section>

      <Section title="Where the pieces come from">
        <Points>
          <li>
            <Link href="/kraken">Kraken</Link>: spot, staked and held balances, and spot-margin
            positions.
          </li>
          <li>
            <Link href="/binance">Binance</Link>: spot, and cross and isolated margin.
          </li>
          <li>
            <Link href="/coinbase">Coinbase</Link>: every account the key can list, and Coinbase
            International perps.
          </li>
          <li>
            <Link href="/hyperliquid">Hyperliquid</Link>: perps on every dex, spot, staked HYPE and
            sub-accounts.
          </li>
          <li>
            <Link href="/aave">Aave</Link>: collateral and debt in every market tula reads.
          </li>
          <li>
            <Link href="/wallets">Wallets</Link>: native and ERC-20 balances on nine EVM chains.
          </li>
          <li>Stripe: every balance bucket, available and pending alike.</li>
        </Points>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, then run it. From there, see what the net
          position does under a <Link href="/stress-test">stress test</Link>, and its{' '}
          <Link href="/liquidation-risk">liquidation risk</Link>.
        </p>
        <Terminal title="try it">{'tula exposure'}</Terminal>
      </Section>
    </Guide>
  )
}
