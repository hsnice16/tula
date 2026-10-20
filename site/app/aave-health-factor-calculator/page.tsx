import { AaveCalculator } from '@/components/AaveCalculator'
import { Code } from '@/components/Code'
import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Formula, Points, Terms } from '@/components/Prose'
import { Table } from '@/components/Table'
import { Terminal } from '@/components/Terminal'
import { collateralLiquidationPrice, dropToLiquidation, healthFactor, OPENING } from '@/lib/calc'
import { dollars, pct, share, usd } from '@/lib/format'
import params from '@/lib/params/aave.json'

const PATH = '/aave-health-factor-calculator'
const TITLE = 'Aave health factor and liquidation price calculator'
const SUMMARY =
  'Calculate an Aave v3 health factor, the liquidation price of each collateral asset and how far it can fall, with every market’s thresholds and eMode.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

const MARKETS = params.markets
const CHAINS = new Set(MARKETS.map((m) => m.chainId)).size
const { CORE, WETH } = (() => {
  const core = MARKETS[0]
  const weth = core?.reserves.find((r) => r.asset === OPENING.aave.asset)
  if (!core || !weth)
    throw new Error('lib/params/aave.json lacks the example asset in its first market')
  return { CORE: core, WETH: weth }
})()
const ETH_EMODE = CORE.emodes.find((e) => e.collateral.includes(WETH.asset))

const EXAMPLE = (() => {
  const { amount, price, debt } = OPENING.aave
  const collateral = [{ value: amount * price, price, threshold: WETH.threshold }]
  const hf = healthFactor(collateral, debt)
  const liquidation = collateralLiquidationPrice(collateral, 0, debt)
  if (hf === null || liquidation === null) throw new Error('the worked example has no liquidation')
  return { amount, price, debt, value: amount * price, hf, liquidation }
})()

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Aave calculator"
      title={TITLE}
      heading={TITLE}
      description={SUMMARY}
      lead="Enter what you supply and what you owe, and get the health factor Aave computes, how far your collateral can fall, and the price each asset liquidates at."
      tool
    >
      <Section title="Calculate your Aave health factor">
        <AaveCalculator />
        <noscript>
          <p className="mt-3 text-dim">
            The calculator needs JavaScript; without it, the figures above are its example.
          </p>
        </noscript>
        <p className="mt-3 text-[0.85rem] text-dim">
          Liquidation thresholds and eMode categories for {MARKETS.length} Aave v3 markets on{' '}
          {CHAINS} chains, read from Aave’s API on {params.asOf}. “Existing only” marks a reserve
          that is frozen or takes no new borrowing against it, but still secures what is already
          there. Free, with no sign-up. Nothing you type leaves this page.
        </p>
      </Section>

      <Section title="What formula does it use?">
        <Formula>HF = Σ (collateral value × liquidation threshold) / total debt</Formula>
        <p className="text-dim">
          Aave v3’s own, as its contracts compute it. Each asset counts at its market’s threshold,
          or its eMode category’s where you pick one and the asset is in it. What a safe level is,
          what happens below 1 and how eMode works are in{' '}
          <Link href="/aave">Aave health factor: formula and safe levels</Link>.
        </p>
      </Section>

      <Section title={`Example: ${EXAMPLE.amount} WETH against ${dollars(EXAMPLE.debt)} of USDC`}>
        <Table
          rows={[
            [
              'Collateral',
              `${EXAMPLE.amount} WETH at ${usd(EXAMPLE.price)} = ${usd(EXAMPLE.value)}`,
            ],
            ['Threshold', `${share(WETH.threshold)} (${CORE.name})`],
            [
              'Health factor',
              `${usd(EXAMPLE.value * WETH.threshold)} / ${usd(EXAMPLE.debt)} = ${EXAMPLE.hf.toFixed(3)}`,
            ],
            ['Can fall', pct(-dropToLiquidation(EXAMPLE.hf))],
            ['Liquidates at', `${usd(EXAMPLE.liquidation)} per WETH`],
          ]}
        />
        <p className="mt-4 text-dim">
          The fall the collateral can take is <Code>1 − 1 / HF</Code>. For one asset’s own
          liquidation price, hold everything else still: price × (debt − the rest’s thresholded
          value) / (this asset’s value × its threshold).
        </p>
      </Section>

      <Section title="How do I fill it in?">
        <Terms
          items={[
            [
              'Market',
              `Thresholds differ between markets for the same asset: WETH is ${share(WETH.threshold)} in ${CORE.name}${ETH_EMODE ? `, and ${share(ETH_EMODE.threshold)} in its “${ETH_EMODE.label}” eMode` : ''}.`,
            ],
            ['Collateral', 'One row per asset you supply, at the price you want to test.'],
            [
              'Debt',
              <>
                The total you owe, interest included. It is held fixed while collateral moves, which
                is right for a stablecoin borrow and wrong for an ETH debt against ETH: there, what
                liquidates you is the two prices parting.
              </>,
            ],
          ]}
        />
      </Section>

      <Section title="What does the health factor leave out?">
        <Points>
          <li>Interest, which raises the debt and lowers the factor every block.</li>
          <li>A debt in a volatile asset, whose price the calculator holds fixed.</li>
          <li>Isolation mode’s debt ceilings, and Aave V4.</li>
        </Points>
      </Section>

      <Section title="How do I check every market at once?">
        <p className="mb-4 text-dim">
          One address can hold a position in all {MARKETS.length} markets, each with its own factor.
          tula reads them all from that address and ranks each beside your{' '}
          <Link href="/hyperliquid-liquidation-calculator">Hyperliquid liquidation price</Link> in
          one <Link href="/liquidation-risk">liquidation risk</Link> list, and a{' '}
          <Link href="/stress-test">stress test</Link> shows each new factor after a move. See{' '}
          <Link href="/aave">what tula reads on Aave</Link>, or{' '}
          <Link href="/install">install it</Link> and run:
        </p>
        <Terminal title="try it">{'tula connect aave\ntula breaks'}</Terminal>
      </Section>
    </Guide>
  )
}
