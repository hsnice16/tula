import { Code } from '@/components/Code'
import { Guide, guideMetadata, Output, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Points, Terms } from '@/components/Prose'
import { Table } from '@/components/Table'
import { Terminal } from '@/components/Terminal'

const PATH = '/liquidation-risk'
const TITLE = 'Crypto liquidation risk across exchanges and DeFi'
const SUMMARY =
  'Distance to liquidation for every position across Hyperliquid, Aave, Binance and Coinbase, in one list ordered by how far the price has to move.'

const DISTANCE = [
  ['Aave', 'Health factor', '1/HF − 1'],
  ['Hyperliquid, standard', 'Liquidation price', 'liq price / price − 1'],
  ['Hyperliquid, unified or portfolio', 'Account ratio', 'ratio / 0.95 − 1'],
  ['Coinbase International perps', 'Liquidation price', 'liq price / price − 1'],
  ['Binance isolated margin', 'Liquidation price', 'liq price / price − 1'],
] as const

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Liquidation risk"
      title={TITLE}
      heading="Crypto liquidation risk across every venue, ranked"
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

      <Section title="What is distance to liquidation?">
        <p className="mb-4 text-dim">
          How far a price can move before a liquidation triggers, as a share of today’s; under an
          account ratio, the share of what backs the account that can go. Venues state the trigger
          three ways, and each turns into one signed distance:
        </p>
        <Table head={['Venue', 'Trigger', 'Distance']} rows={DISTANCE} />
        <p className="text-dim">
          The sign is the direction: a long or Aave collateral liquidates on a fall, a short on a
          rise. Above, one ETH book is 27% from liquidation on a fall and 39.3% on a rise.
        </p>
      </Section>

      <Section title="Why one venue’s screen is not enough">
        <Points>
          <li>Each venue ranks only its own positions, in its own unit.</li>
          <li>
            A hedge on another venue moves the other way: the short that profits on a fall says
            nothing to the Aave market it protects.
          </li>
          <li>One move in ETH reaches every venue holding it at once.</li>
        </Points>
      </Section>

      <Section title="How the move is found">
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Aave:</strong> from the health factor.{' '}
          <Link href="/aave">Aave health factor</Link>.
        </p>
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Hyperliquid:</strong> from the liquidation
          price, or the account ratio under unified or portfolio margin.{' '}
          <Link href="/hyperliquid">Hyperliquid liquidation price</Link>.
        </p>
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Coinbase International perps:</strong> from the
          liquidation price Coinbase publishes.{' '}
          <Link href="/coinbase">Coinbase read-only API key</Link>.
        </p>
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Binance isolated margin:</strong> from the
          liquidation price Binance states for the pair. <Link href="/binance">Binance margin</Link>
          .
        </p>
        <p className="mb-3 text-dim">
          A position already past its trigger reads “liquidatable now”. A position with nothing to
          rank on sorts last, as unknown, never as safe.
        </p>
        <p className="text-dim">
          To work one out by hand, use the{' '}
          <Link href="/hyperliquid-liquidation-calculator">
            Hyperliquid liquidation price calculator
          </Link>{' '}
          or the <Link href="/aave-health-factor-calculator">Aave health factor calculator</Link>.
        </p>
      </Section>

      <Section title="How to move further from liquidation">
        <Terms
          items={[
            [
              'Aave',
              'Repay debt or supply collateral: both raise the health factor, and the distance with it.',
            ],
            [
              'Perps',
              'Add margin or cut size. On cross margin, more account value moves every cross position’s price at once.',
            ],
            [
              'Hedges',
              'A hedge on another venue has a liquidation of its own, on the opposite move.',
            ],
          ]}
        />
      </Section>

      <Section title="Where the order can be wrong">
        <p className="text-dim">
          When a venue has an area tula does not read that could hold a liquidation,{' '}
          <Code>breaks</Code> says so under the list. Kraken’s account margin level is one.{' '}
          <Link href="/kraken">Kraken margin</Link>.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          A <Link href="/stress-test">stress test</Link> shows what a move would call in.{' '}
          <Link href="/install">Install tula</Link>, connect your venues, then:
        </p>
        <Terminal title="try it">{'tula breaks\ntula shock ETH -20'}</Terminal>
      </Section>
    </Guide>
  )
}
