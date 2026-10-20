import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { FundingCalculator } from '@/components/FundingCalculator'
import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Formula, Points } from '@/components/Prose'
import { Table } from '@/components/Table'
import { Terminal } from '@/components/Terminal'
import { FUNDING, fundingPaid, OPENING } from '@/lib/calc'
import { dollars, percent, usd } from '@/lib/format'

const PATH = '/hyperliquid-funding-calculator'
const TITLE = 'Hyperliquid funding rate calculator: cost and APR'
const SUMMARY =
  'Work out what Hyperliquid funding costs or pays a long or short: per hour, per day, over the days you hold it, and as a yearly rate.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

const DOCS = 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding'

const OPEN = OPENING.funding
const EXAMPLE = [1, 24, 24 * OPEN.days].map((hours) =>
  fundingPaid(1, OPEN.notional, OPEN.ratePerHour, hours),
)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Funding calculator"
      title={TITLE}
      heading="Hyperliquid funding rate calculator"
      description={SUMMARY}
      lead="Enter a position and the hourly rate Hyperliquid shows, and get what funding costs or pays you each hour, each day, over the time you hold it, and in a year."
      tool
    >
      <Section title="Calculate Hyperliquid funding">
        <FundingCalculator />
        <noscript>
          <p className="mt-3 text-dim">
            The calculator needs JavaScript; without it, the figures above are its example.
          </p>
        </noscript>
        <p className="mt-3 text-[0.85rem] text-dim">
          The rate changes every hour, so the calculator holds the one you type still. Free, with no
          sign-up. Nothing you type leaves this page.
        </p>
      </Section>

      <Section title="How is Hyperliquid funding calculated?">
        <Formula>payment = position size × oracle price × hourly funding rate</Formula>
        <p className="mb-3 text-dim">
          Hyperliquid pays funding every hour, at an eighth of its 8-hour rate. A positive rate is
          paid by longs to shorts, a negative one by shorts to longs, and the exchange takes no cut.
          The position is valued at the oracle price, not the mark price.
        </p>
        <p className="text-dim">
          The rate is a premium, how far the perp trades from the oracle, plus an interest rate of{' '}
          {percent(FUNDING.interestPerHour, 5)} an hour. It is capped at{' '}
          {percent(FUNDING.capPerHour, 0)} an hour for every asset. Source:{' '}
          <Ext href={DOCS}>Hyperliquid funding</Ext>.
        </p>
      </Section>

      <Section
        title={`Example: a ${dollars(OPEN.notional)} long at ${percent(OPEN.ratePerHour, 5)} an hour`}
      >
        <Table
          rows={[
            ['Per hour', usd(EXAMPLE[0] ?? 0)],
            ['Per day', usd(EXAMPLE[1] ?? 0)],
            [`Over ${OPEN.days} days`, usd(EXAMPLE[2] ?? 0)],
            ['A year', percent(OPEN.ratePerHour * 24 * 365)],
          ]}
        />
        <p className="mt-4 text-dim">
          That is the rate at rest, with the perp at the oracle price. A crowded long pushes it
          higher, and a short collects whatever longs pay.
        </p>
      </Section>

      <Section title="Where do I find the current rate?">
        <p className="text-dim">
          On Hyperliquid&rsquo;s trade screen, beside the countdown to the next payment. It is the
          hourly rate, the one this calculator takes.
        </p>
      </Section>

      <Section title="What does it leave out?">
        <Points>
          <li>The rate changing, which it does every hour.</li>
          <li>The price moving, which changes the position&rsquo;s value and so each payment.</li>
          <li>Trading fees, which are charged apart from funding.</li>
        </Points>
      </Section>

      <Section title="How do I see what my positions have paid?">
        <p className="mb-4 text-dim">
          tula reads it from Hyperliquid for every perp you hold: the funding each position has paid
          or received since it opened, and all time, beside its{' '}
          <Link href="/hyperliquid-liquidation-calculator">liquidation price</Link>. A public
          address is enough. <Link href="/install">Install tula</Link>, then:
        </p>
        <Terminal title="try it">{'tula connect hyperliquid\ntula position BTC'}</Terminal>
        <p className="mt-4 text-dim">
          <Code>position</Code> takes any asset you hold. See also{' '}
          <Link href="/hyperliquid">how Hyperliquid liquidation works</Link>.
        </p>
      </Section>
    </Guide>
  )
}
