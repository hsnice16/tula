import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Formula, Points, Terms } from '@/components/Prose'
import { Table } from '@/components/Table'
import { Terminal } from '@/components/Terminal'
import {
  maintenanceMargin,
  maintenanceRate,
  PARTIAL_LIQUIDATION,
  perpLiquidationPrice,
} from '@/lib/calc'
import { dollars, pct, percent, share, usd } from '@/lib/format'
import params from '@/lib/params/hyperliquid.json'

const PATH = '/hyperliquid'
const TITLE = 'How Hyperliquid liquidation works: cross vs isolated'
const SUMMARY =
  'The Hyperliquid liquidation price formula for cross and isolated margin, maintenance margin and tiers, and how unified and portfolio margin accounts liquidate.'

const DOCS = 'https://hyperliquid.gitbook.io/hyperliquid-docs'

const TERMS = [
  ['side', '1 for a long, −1 for a short.'],
  ['l', 'The maintenance margin rate: 1 / maintenance leverage.'],
  ['margin_available, cross', 'account_value − maintenance_margin_required'],
  ['margin_available, isolated', 'isolated_margin − maintenance_margin_required'],
] as const

const tiersOf = (asset: string) => {
  const tiers = params.perps.find((p) => p.asset === asset)?.tiers
  if (!tiers?.[0]) throw new Error(`lib/params/hyperliquid.json has no ${asset} perp`)
  return tiers
}
const millions = (n: number) => `$${n / 1e6}M`
const rate = (maxLeverage: number) => percent(maintenanceRate(maxLeverage))

const ETH_TIERS = tiersOf('ETH')
const BTC_TIERS = tiersOf('BTC')
const ETH_MAX = ETH_TIERS[0]?.maxLeverage ?? 1
const HIGHEST = Math.max(...params.perps.map((p) => p.tiers[0]?.maxLeverage ?? 1))
const LOWEST = Math.min(...params.perps.map((p) => p.tiers[0]?.maxLeverage ?? 1))
const FIRST_BOUNDS = params.perps.flatMap((p) => p.tiers[1]?.from ?? [])

/** Long 1 ETH at $2,450: 10x isolated against the same position in a $1,000 cross account. */
const EXAMPLE = (() => {
  const mark = 2450
  const position = { side: 1 as const, size: 1, mark, otherMaintenance: 0, tiers: ETH_TIERS }
  const maintenance = maintenanceMargin(ETH_TIERS, mark)
  const column = (margin: number) => {
    const price = perpLiquidationPrice({ ...position, equity: margin })
    if (price === null) throw new Error('the worked example has no liquidation')
    return [
      usd(margin),
      usd(maintenance),
      usd(margin - maintenance),
      usd(price),
      pct((price - mark) / mark, 1),
    ]
  }
  const isolated = column(mark / 10)
  const cross = column(1000)
  return [
    'Margin behind it',
    'Maintenance margin',
    'margin_available',
    'Liquidation price',
    'Move to liquidation',
  ].map((row, i) => [row, isolated[i] ?? '', cross[i] ?? ''])
})()

const RATES = [
  ['BTC', `${BTC_TIERS[0]?.maxLeverage}x`, rate(BTC_TIERS[0]?.maxLeverage ?? 1)],
  ['ETH', `${ETH_MAX}x`, rate(ETH_MAX)],
  ['The lowest', `${LOWEST}x`, rate(LOWEST)],
]

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Hyperliquid"
      title={TITLE}
      heading="Hyperliquid liquidation price: cross, isolated, unified and portfolio margin"
      description={SUMMARY}
      lead="Hyperliquid liquidates when the margin behind a position falls below its maintenance margin. Where that line sits depends on cross or isolated margin, and on the account mode."
    >
      <Section title="How is the Hyperliquid liquidation price calculated?">
        <Formula>
          liq_price = price − side × margin_available / position_size / (1 − l × side)
        </Formula>
        <Terms items={TERMS.map(([term, meaning]) => [<Code key={term}>{term}</Code>, meaning])} />
        <p className="text-dim">
          Liquidations trigger on the mark price, which combines external exchange prices with
          Hyperliquid’s own book. Source:{' '}
          <Ext href={`${DOCS}/trading/liquidations`}>Hyperliquid liquidations</Ext>.
        </p>
      </Section>

      <Section title="Liquidation price in cross vs isolated margin">
        <p className="mb-4 text-dim">
          A long of 1 ETH at $2,450, where ETH’s {ETH_MAX}x max leverage makes <Code>l</Code>{' '}
          {1 / (2 * ETH_MAX)}:
        </p>
        <Table head={['', 'Isolated', 'Cross']} rows={EXAMPLE} />
        <p className="mt-4 text-dim">
          Isolated margin is only what you posted to the position, so it dies alone. Cross margin is
          the whole cross balance, so the price moves with every other cross position’s profit or
          loss. Fees and funding are left out. Try your own in the{' '}
          <Link href="/hyperliquid-liquidation-calculator">
            Hyperliquid liquidation price calculator
          </Link>
          .
        </p>
      </Section>

      <Section title="Maintenance margin is half the initial margin at max leverage">
        <Formula>maintenance margin rate = 1 / (2 × max leverage)</Formula>
        <p className="mb-4 text-dim">
          Max leverage is set per asset, so the rate runs from {rate(HIGHEST)} to {rate(LOWEST)}.
        </p>
        <Table head={['Asset', 'Max leverage', 'Maintenance']} rows={RATES} />
      </Section>

      <Section title="Margin tiers">
        <Formula>maintenance_margin = notional × rate − deduction</Formula>
        <p className="mb-3 text-dim">
          Above a notional bound, a tier lowers max leverage, which raises the rate; the deduction
          is zero in the first tier.
        </p>
        <p className="text-dim">
          {FIRST_BOUNDS.length} of {params.perps.length} perps have tiers, the first starting at{' '}
          {millions(Math.min(...FIRST_BOUNDS))}, {millions(ETH_TIERS[1]?.from ?? 0)} for ETH and{' '}
          {millions(BTC_TIERS[1]?.from ?? 0)} for BTC. Every other perp has one tier. Source:{' '}
          <Ext href={`${DOCS}/trading/margin-tiers`}>Hyperliquid margin tiers</Ext>.
        </p>
      </Section>

      <Section title="What happens at liquidation?">
        <Points>
          <li>
            Market orders go to the book first. Collateral left once the account is back above
            maintenance stays yours.
          </li>
          <li>
            Above {dollars(PARTIAL_LIQUIDATION.from)}, the first order is for{' '}
            {share(PARTIAL_LIQUIDATION.share)} of the position. For 30 seconds after it, any further
            one is for the whole position.
          </li>
          <li>
            Below two thirds of maintenance margin with no fill, the liquidator vault can take over:
            every cross position and the cross margin, or one isolated position and its margin. The
            maintenance margin is not returned.
          </li>
        </Points>
      </Section>

      <Section title="Account modes, and how each liquidates">
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Standard.</strong> Spot and perps are separate
          balances, and each dex has its own. Each position liquidates at its own price.
        </p>
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Unified account.</strong> One balance per asset
          backs spot and every cross position margined in it. Hyperliquid&rsquo;s app warns the
          account may be liquidated once its Unified Account Ratio is above 95%.
        </p>
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Portfolio margin.</strong> One portfolio of
          HYPE, BTC, USDC and USDT, borrowing against them as needed. Hyperliquid documents the
          account as liquidatable once its Portfolio Margin Ratio passes 95%.
        </p>
        <p className="text-dim">
          Source: <Ext href={`${DOCS}/trading/account-abstraction-modes`}>account modes</Ext> and{' '}
          <Ext href={`${DOCS}/trading/portfolio-margin`}>portfolio margin</Ext>.
        </p>
      </Section>

      <Section title="What tula reads, and what it does not">
        <p className="mb-3 text-dim">
          The account mode and its balances, perps on every builder-deployed dex, staked HYPE, and
          every sub-account as an account of its own, all counted in{' '}
          <Link href="/exposure">net exposure</Link>. Vault equity counts in the total but not in
          net exposure: it is a claim on a pool, not the coin.
        </p>
        <p className="mb-3 text-dim">
          Each liquidation price is the one Hyperliquid states, never recomputed. Under unified or
          portfolio margin, <Code>breaks</Code> ranks the whole account on its ratio, beside any{' '}
          <Link href="/aave">Aave health factor</Link>. See{' '}
          <Link href="/liquidation-risk">liquidation risk across venues</Link>.
        </p>
        <p className="mb-3 text-dim">
          To follow one account by its address, see the{' '}
          <Link href="/hyperliquid-portfolio-tracker">Hyperliquid portfolio tracker</Link>; to price
          funding, the <Link href="/hyperliquid-funding-calculator">funding rate calculator</Link>.
          When a dex does not load, the unified ratio shows as “at least” the figure over the dexes
          that did, and the one that did not is named.
        </p>
        <p className="text-dim">Not read: balances on HyperEVM, Hyperliquid’s own EVM chain.</p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          A public address is enough. <Link href="/install">Install tula</Link>, then:
        </p>
        <Terminal title="try it">{'tula connect hyperliquid\ntula breaks'}</Terminal>
      </Section>
    </Guide>
  )
}
