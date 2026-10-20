import { Code } from '@/components/Code'
import { Guide, guideMetadata, Output, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Formula, Terms } from '@/components/Prose'
import { Table } from '@/components/Table'
import { Terminal } from '@/components/Terminal'
import { pct } from '@/lib/format'

const PATH = '/stress-test'
const TITLE = 'Crypto portfolio stress test: what if ETH drops 20%'
const SUMMARY =
  'Stress test a crypto portfolio: move any asset by a percentage on every exchange and DeFi venue at once, and see equity, health factors and what liquidates.'

/** What each part of the shock output says, in the order it prints. */
const READING = [
  ['Before, After, Change', 'Equity at today’s prices, at the moved ones, and the difference.'],
  ['Health factors', 'Each Aave market, before and after.'],
  ['Account ratios', 'Each Hyperliquid account liquidated on a ratio, before and after.'],
  ['LIQUIDATED', 'Every position the move takes, by venue, or a line saying nothing does.'],
] as const

/** A health factor of 1.37 on ETH-only collateral, under each fall: HF × (1 + move). */
const LADDER = [-0.1, -0.2, -0.28, -0.3].map((move) => [
  pct(move, 0),
  (1.37 * (1 + move)).toFixed(2),
])

const SHOCKS = [
  ['shock ETH -20', 'A bad day for one asset.'],
  ['shock ETH -40 BTC -30', 'A market-wide fall, each asset by its own amount.'],
  ['shock ETH 30', 'A rise, which is what liquidates a short.'],
] as const

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Stress test"
      title={TITLE}
      heading={TITLE}
      description={SUMMARY}
      lead="Each venue can only move its own prices. tula moves one price for every venue at once."
    >
      <Section title="One move, every venue">
        <p className="mb-4 text-dim">
          <Code>shock</Code> reprices the whole book, then says what survives.
        </p>
        <Output title="tula shock ETH -20">
          {`Scenario: ETH -20%

  Before   $41,434.48
  After    $38,180.88
  Change   -$3,253.60

Health factors:
  aave  health factor 1.37 -> 1.10

Nothing liquidates at this level.`}
        </Output>
      </Section>

      <Section title="What is a portfolio stress test?">
        <p className="text-dim">
          Reprice what you hold under a move that has not happened, and check what survives: the
          total, every margin and loan, and every liquidation. Asked one venue at a time it misses
          the point, because the same ETH sits on several and one move reaches all of them.
        </p>
      </Section>

      <Section title="What if ETH drops 20%? Reading the result">
        <Terms
          items={READING.map(([part, meaning]) => [<Code key={part}>{part}</Code>, meaning])}
        />
        <p className="text-dim">
          Above, 8.64 ETH of spot and collateral lose $4,233.60, the 2 ETH{' '}
          <Link href="/hyperliquid">Hyperliquid</Link> short gains $980.00, and the book is down
          $3,253.60. Aave’s factor falls from 1.37 to 1.10 and survives.
        </p>
      </Section>

      <Section title="How a health factor moves">
        <Formula>HF after = HF × (1 + collateral move)</Formula>
        <p className="mb-4 text-dim">With ETH as the only collateral and a stablecoin debt:</p>
        <Table head={['ETH move', 'Health factor 1.37']} rows={LADDER} />
        <p className="mt-4 text-dim">
          With several assets pledged, the move is weighted by each one’s value and liquidation
          threshold, so a fall in one moves the factor by its share. The debt is held still; when
          the move reprices something borrowed, <Code>shock</Code> says whether the real factor is
          higher or lower. <Link href="/aave">How the Aave health factor works</Link>, or try a move
          in the <Link href="/aave-health-factor-calculator">Aave health factor calculator</Link>.
        </p>
      </Section>

      <Section title="What it recomputes">
        <p className="mb-3 text-dim">
          The book’s total, each <Link href="/aave">Aave health factor</Link>, and each{' '}
          <Link href="/hyperliquid">Hyperliquid account ratio</Link>. A ratio it cannot recompute is
          named, never assumed to survive.
        </p>
        <p className="text-dim">
          Then every position the move liquidates, by venue. See the{' '}
          <Link href="/liquidation-risk">liquidation risk ranking</Link> for how far each one is
          today, and <Link href="/exposure">net exposure</Link> for what the move is applied to.
        </p>
      </Section>

      <Section title="Scenarios worth running">
        <Terms
          items={SHOCKS.map(([command, means]) => [<Code key={command}>{command}</Code>, means])}
        />
        <p className="mb-4 text-dim">
          Each asset takes its own move, from −100% up to +10,000%. An asset you do not name keeps
          its price.
        </p>
        <Terminal title="two moves">{'tula shock ETH -20 BTC -10'}</Terminal>
      </Section>

      <Section title="What it leaves out">
        <p className="text-dim">
          It reprices and nothing else: fees, funding and slippage are not in the result.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, connect your venues, then:
        </p>
        <Terminal title="try it">{'tula shock ETH -20'}</Terminal>
      </Section>
    </Guide>
  )
}
