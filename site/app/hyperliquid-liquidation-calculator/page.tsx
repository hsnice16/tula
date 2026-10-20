import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { Guide, guideMetadata, Section } from '@/components/Guide'
import { HyperliquidCalculator } from '@/components/HyperliquidCalculator'
import { Link } from '@/components/Link'
import { Formula, Points, Terms } from '@/components/Prose'
import { Table } from '@/components/Table'
import { Terminal } from '@/components/Terminal'
import { maintenanceMargin, maintenanceRate, OPENING, perpLiquidationPrice } from '@/lib/calc'
import { dollars, pct, percent, usd } from '@/lib/format'
import params from '@/lib/params/hyperliquid.json'

const PATH = '/hyperliquid-liquidation-calculator'
const TITLE = 'Hyperliquid liquidation price calculator'
const SUMMARY =
  'Work out a Hyperliquid liquidation price for a long or short, isolated or cross, with each asset’s real max leverage and margin tiers.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

const DOCS = 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading'

const OPEN = OPENING.hyperliquid
const TIERS = params.perps.find((p) => p.asset === OPEN.asset)?.tiers
if (!TIERS?.[0]) throw new Error(`lib/params/hyperliquid.json has no ${OPEN.asset} perp`)
const MAX = TIERS[0].maxLeverage

/** The inputs whose meaning is not in their label. */
const FIELDS = [
  [
    'Isolated',
    'Size and leverage set the margin, and only that margin stands behind the position.',
  ],
  [
    'Cross',
    'Leverage only sets the margin needed to open. Add the account’s other free USDC and the maintenance its other cross positions hold; both are held still while this price moves.',
  ],
  ['Mark price now', 'For a position already open: its unrealised PnL counts toward the margin.'],
] as const

const EXAMPLE = (() => {
  const { entry, notional, leverage } = OPEN
  const size = notional / entry
  const margin = notional / leverage
  const input = { size, mark: entry, equity: margin, otherMaintenance: 0, tiers: TIERS }
  const long = perpLiquidationPrice({ ...input, side: 1 })
  const short = perpLiquidationPrice({ ...input, side: -1 })
  if (long === null || short === null) throw new Error('the worked example has no liquidation')
  const maintenance = maintenanceMargin(TIERS, notional)
  return { entry, notional, leverage, size, margin, maintenance, long, short }
})()

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Hyperliquid calculator"
      title={TITLE}
      heading={TITLE}
      description={SUMMARY}
      lead="Enter a position and get the mark price Hyperliquid liquidates it at, using the venue’s own formula, the asset’s max leverage and its margin tiers."
      tool
    >
      <Section title="Calculate a Hyperliquid liquidation price">
        <HyperliquidCalculator />
        <noscript>
          <p className="mt-3 text-dim">
            The calculator needs JavaScript; without it, the figures above are its example.
          </p>
        </noscript>
        <p className="mt-3 text-[0.85rem] text-dim">
          Max leverage and margin tiers for {params.perps.length} perps, read from Hyperliquid’s{' '}
          <Code>meta</Code> endpoint on {params.asOf}. Free, with no sign-up. Nothing you type
          leaves this page.
        </p>
      </Section>

      <Section title="What formula does it use?">
        <Formula>
          liq_price = price − side × margin_available / position_size / (1 − l × side)
        </Formula>
        <p className="text-dim">
          Hyperliquid’s own, from its <Ext href={`${DOCS}/liquidations`}>liquidation docs</Ext>,
          with <Code>l</Code> the maintenance rate: half the initial margin at the asset’s max
          leverage, {percent(maintenanceRate(MAX))} for {OPEN.asset} whatever leverage you chose.
          Above a tier’s bound the rate rises, and the calculator applies the tier at the position’s
          value at the liquidation price, as the docs specify. What each term means, the tiers and
          what happens once the price is reached are in{' '}
          <Link href="/hyperliquid">How Hyperliquid liquidation works: cross vs isolated</Link>.
        </p>
      </Section>

      <Section
        title={`Example: ${dollars(EXAMPLE.notional)} of ${OPEN.asset} at ${EXAMPLE.leverage}x, isolated`}
      >
        <Table
          rows={[
            ['Entry', usd(EXAMPLE.entry)],
            ['Size', `${EXAMPLE.size} ${OPEN.asset}`],
            ['Margin', `${usd(EXAMPLE.margin)} (${usd(EXAMPLE.notional)} / ${EXAMPLE.leverage})`],
            ['Maintenance', usd(EXAMPLE.maintenance)],
            [
              'Long liquidates at',
              `${usd(EXAMPLE.long)} (${pct((EXAMPLE.long - EXAMPLE.entry) / EXAMPLE.entry)})`,
            ],
            [
              'Short liquidates at',
              `${usd(EXAMPLE.short)} (${pct((EXAMPLE.short - EXAMPLE.entry) / EXAMPLE.entry)})`,
            ],
          ]}
        />
        <p className="mt-4 text-dim">
          At {EXAMPLE.leverage}x the position loses its margin after a{' '}
          {Math.round(100 / EXAMPLE.leverage)}% move, but it is liquidated sooner, when what is left
          reaches maintenance. The two sides are not mirror images: a short’s maintenance grows as
          the price rises toward its trigger, and a long’s shrinks as it falls.
        </p>
      </Section>

      <Section title="How do I fill it in?">
        <Terms items={FIELDS} />
      </Section>

      <Section title="What does the liquidation price leave out?">
        <Points>
          <li>Funding and fees, which change the margin over time.</li>
          <li>The gap between the mark price and the last trade: liquidation follows the mark.</li>
          <li>
            Unified and portfolio margin accounts, which liquidate on an account ratio rather than a
            price per position — see{' '}
            <Link href="/hyperliquid">Hyperliquid account modes and liquidation</Link>.
          </li>
          <li>Perps on builder-deployed dexes, which are not in the asset list.</li>
        </Points>
      </Section>

      <Section title="How do I check every position at once?">
        <p className="mb-4 text-dim">
          A calculator answers for one position you type in. tula reads the liquidation price, or
          the account ratio, Hyperliquid states for every position you hold, sub-accounts included,
          and ranks them beside your{' '}
          <Link href="/aave-health-factor-calculator">Aave health factor</Link> and the rest of your
          book in one <Link href="/liquidation-risk">liquidation risk</Link> list. A public address
          is enough. <Link href="/install">Install tula</Link>, then:
        </p>
        <Terminal title="try it">{'tula connect hyperliquid\ntula breaks'}</Terminal>
      </Section>
    </Guide>
  )
}
