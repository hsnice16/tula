import { Code } from '@/components/Code'
import { Guide, guideMetadata, Output, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Terminal } from '@/components/Terminal'

const PATH = '/liquidation-risk'
const TITLE = 'Liquidation risk across exchanges and DeFi, ranked'
const SUMMARY =
  'Every position that can be liquidated, across Hyperliquid, Aave and exchanges, in one list ordered by how far the price has to move.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Liquidation risk"
      title={TITLE}
      heading="Liquidation risk across every venue"
      description={SUMMARY}
      lead="Each venue shows its own liquidation risk. None can rank it against another venue’s. tula does."
    >
      <Section title="One ranked list">
        <p className="mb-4 text-dim">
          <Code>breaks</Code> lists every position that can be liquidated, nearest first, with the
          price move that liquidates it.
        </p>
        <Output title="tula breaks">
          {`VENUE        ASSET  KIND        MOVE TO LIQ  TRIGGER              AS OF
───────────  ─────  ──────────  ───────────  ───────────────────  ─────────────────
aave         ETH    collateral       -27.0%  health factor 1.37   09:14:02 (4s ago)
hyperliquid  ETH    perp             +39.3%  liq price $3,412.00  09:14:02 (4s ago)`}
        </Output>
      </Section>

      <Section title="How the move is found">
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Aave:</strong> from the health factor.{' '}
          <Link href="/aave">More on Aave</Link>.
        </p>
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Hyperliquid:</strong> from the liquidation
          price, or the account ratio under unified or portfolio margin.{' '}
          <Link href="/hyperliquid">More on Hyperliquid</Link>.
        </p>
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Coinbase perps:</strong> from the liquidation
          price Coinbase publishes. <Link href="/coinbase">More on Coinbase</Link>.
        </p>
        <p className="text-dim">
          A position with nothing to rank on sorts last, as unknown, never as safe.
        </p>
      </Section>

      <Section title="Where the order can be wrong">
        <p className="text-dim">
          When a venue has an area tula does not read that could hold a liquidation,{' '}
          <Code>breaks</Code> says so under the list. Kraken’s account margin level is one.{' '}
          <Link href="/kraken">More on Kraken</Link>.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, connect your venues, then:
        </p>
        <Terminal title="try it">{'tula breaks\ntula shock ETH -20'}</Terminal>
      </Section>
    </Guide>
  )
}
