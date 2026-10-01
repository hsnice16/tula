import { Code } from '@/components/Code'
import { Guide, guideMetadata, Output, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Terminal } from '@/components/Terminal'

const PATH = '/stress-test'
const TITLE = 'Crypto portfolio stress test: what if ETH drops 20%'
const SUMMARY =
  'Move a price across every venue at once and see the new total, each health factor and account ratio, and what liquidates.'

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

      <Section title="What it recomputes">
        <p className="mb-3 text-dim">
          The book’s total, each <Link href="/aave">Aave health factor</Link>, and each{' '}
          <Link href="/hyperliquid">Hyperliquid account ratio</Link>. A ratio it cannot recompute is
          named, never assumed to survive.
        </p>
        <p className="text-dim">
          Then every position the move liquidates, by venue. See the{' '}
          <Link href="/liquidation-risk">liquidation risk ranking</Link> for how far each one is
          today.
        </p>
      </Section>

      <Section title="More than one asset">
        <p className="mb-4 text-dim">Each asset takes its own move.</p>
        <Terminal title="two moves">{'tula shock ETH -20 BTC -10'}</Terminal>
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
