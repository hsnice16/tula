import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Formula, Terms } from '@/components/Prose'
import { Table } from '@/components/Table'
import { Terminal } from '@/components/Terminal'
import {
  CLOSE_FACTOR_HF_THRESHOLD,
  CLOSE_FACTOR_RESERVE_FLOOR,
  dropToLiquidation,
} from '@/lib/calc'
import { dollars, percent } from '@/lib/format'

const PATH = '/aave'
const TITLE = 'Aave health factor: formula and safe levels'
const SUMMARY =
  'How the Aave v3 health factor is calculated, what level is safe, how eMode and the close factor work, and how far collateral can fall before liquidation.'

const GENERIC_LOGIC =
  'https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/protocol/libraries/logic/GenericLogic.sol'
const LIQUIDATION_LOGIC =
  'https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/protocol/libraries/logic/LiquidationLogic.sol'

const TERMS = [
  [
    'Collateral value',
    'Each supplied asset with collateral turned on, at the price Aave’s oracle gives it.',
  ],
  [
    'Liquidation threshold',
    'Set per asset, per market. At 0.80, 80% of that asset’s value counts toward the debt.',
  ],
  ['Total debt', 'Everything borrowed in that market, interest included.'],
  ['No debt', 'Nothing to liquidate, so no health factor to fall.'],
] as const

/** Health factor, and how far the collateral can fall from it. */
const ROOM = [1.1, 1.25, 1.37, 1.5, 2, 3].map((hf) => [
  hf.toFixed(2),
  percent(dropToLiquidation(hf), 1),
])

const CLOSE = [
  [
    `Health factor above ${CLOSE_FACTOR_HF_THRESHOLD}`,
    'At most 50% of your total debt in one liquidation (the close factor), and never more than the reserve being repaid.',
  ],
  [
    `Health factor ${CLOSE_FACTOR_HF_THRESHOLD} or below`,
    'Up to all of the debt in the reserve being repaid.',
  ],
  [
    `A reserve under ${dollars(CLOSE_FACTOR_RESERVE_FLOOR)}`,
    `If the collateral or the debt being liquidated is worth under ${dollars(CLOSE_FACTOR_RESERVE_FLOOR)}: up to all of it, whatever the health factor.`,
  ],
  [
    'What is left',
    'At least $1,000 of that debt and of that collateral, unless one is cleared entirely.',
  ],
] as const

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Aave"
      title={TITLE}
      heading="The Aave health factor: how it is calculated, and how far it can fall"
      description={SUMMARY}
      lead="Aave v3 liquidates a position once its health factor falls below 1. The number is one ratio, and it says exactly how far prices can fall first."
    >
      <Section title="How is the Aave health factor calculated?">
        <Formula>HF = Σ (collateral value × liquidation threshold) / total debt</Formula>
        <Terms items={TERMS} />
        <p className="text-dim">
          The loan-to-value ratio is not in it: LTV caps what you can borrow, the threshold decides
          when you are liquidated. Source: Aave v3’s{' '}
          <Ext href={GENERIC_LOGIC}>GenericLogic.sol</Ext>.
        </p>
      </Section>

      <Section title="A worked example">
        <p className="text-dim">
          $10,000 of ETH at a threshold of 0.80 against $6,000 of USDC debt:{' '}
          <Code>10,000 × 0.80 / 6,000 = 1.33</Code>. The ETH can fall 25%, to $7,500, before its
          thresholded value equals the debt and the health factor reaches 1.
        </p>
      </Section>

      <Section title="How far can collateral fall?">
        <p className="mb-4 text-dim">
          At a health factor of HF, the collateral can fall 1 − 1/HF before the market is
          liquidatable. At 2 that is 50%. At 1.37, about 27%.
        </p>
        <Table head={['Health factor', 'Collateral can fall']} rows={ROOM} />
        <p className="mt-4 text-dim">
          This holds the debt still, which a stablecoin borrow is. Borrow the asset you supplied and
          both sides move together. Work your own numbers in the{' '}
          <Link href="/aave-health-factor-calculator">Aave health factor calculator</Link>.
        </p>
      </Section>

      <Section title="What is a safe health factor?">
        <p className="text-dim">
          Aave’s contracts fix one level only: 1. Work back from the largest fall you want to
          survive: <Code>HF = 1 / (1 − fall)</Code>. Surviving 30% takes 1.43, surviving 50% takes
          2.
        </p>
      </Section>

      <Section title="What happens when it falls below 1?">
        <p className="mb-4 text-dim">
          Anyone may repay part of the debt and take collateral at a discount, the liquidation bonus
          each reserve sets. How much one liquidation may take:
        </p>
        <Terms items={CLOSE} />
        <p className="text-dim">
          Source: <Ext href={LIQUIDATION_LOGIC}>LiquidationLogic.sol</Ext>, and Aave’s{' '}
          <Ext href="https://aave.com/docs/aave-v3/overview">v3 overview</Ext>.
        </p>
      </Section>

      <Section title="How does eMode change it?">
        <p className="text-dim">
          Efficiency mode (eMode) groups correlated assets, such as USD-pegged stablecoins, into a
          category with a liquidation threshold of its own, usually higher. In eMode, every asset in
          the category counts at the category’s threshold instead of its own; the rest keep theirs.
          The same position then usually carries a higher health factor.
        </p>
      </Section>

      <Section title="What tula reads, and what it does not">
        <p className="mb-3 text-dim">
          Collateral, variable-rate debt and each market’s health factor, across twelve markets on{' '}
          <Link href="/wallets">nine chains</Link>: Ethereum, Arbitrum One, Base, Polygon, Optimism,
          Avalanche, Gnosis, Scroll and Linea, from one public address.
        </p>
        <p className="text-dim">
          Each market’s own liquidation thresholds, and its eMode category’s where the account is in
          one. All of it counts in <Link href="/exposure">net exposure</Link>.
        </p>
        <p className="mt-3 text-dim">
          Not read: Aave V4, Umbrella and the legacy Safety Module, isolation mode, and other
          chains.
        </p>
      </Section>

      <Section title="Ask what if">
        <p className="mb-4 text-dim">
          A <Link href="/stress-test">stress test</Link>: <Code>shock</Code> reprices the book and
          shows each new health factor, weighting every asset by its value and threshold, beside any{' '}
          <Link href="/hyperliquid">Hyperliquid liquidation price</Link>. When the move reprices
          something you borrowed, it says the real factor is higher or lower. See{' '}
          <Link href="/liquidation-risk">liquidation risk across venues</Link>.
        </p>
        <Terminal title="shock">{'tula shock ETH -20'}</Terminal>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          A public address is enough. <Link href="/install">Install tula</Link>, then:
        </p>
        <Terminal title="try it">{'tula connect aave\ntula breaks'}</Terminal>
      </Section>
    </Guide>
  )
}
