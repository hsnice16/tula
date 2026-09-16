import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Terminal } from '@/components/Terminal'

const PATH = '/binance'
const TITLE = 'Binance read-only API key for portfolio tracking'
const SUMMARY =
  'Which Binance API restriction to turn on so a tool can read balances and positions but never trade or withdraw, and what tula refuses.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Binance"
      title={TITLE}
      heading="A read-only Binance API key"
      description={SUMMARY}
      lead="Binance keys come with restrictions you tick. To read, tick one."
    >
      <Section title="The key to create">
        <p className="text-dim">Create a key with only Enable Reading turned on.</p>
      </Section>

      <Section title="What tula checks">
        <p className="text-dim">
          Binance reports what a key can do. A key that can trade, withdraw or move your funds is
          refused.
        </p>
      </Section>

      <Section title="What tula reads">
        <p className="text-dim">
          Spot balances, free and locked stated apart, and cross and isolated margin with the
          liquidation price each carries.
        </p>
      </Section>

      <Section title="Not read">
        <p className="text-dim">
          Futures, because Binance&rsquo;s futures permission grants trading and a key holding it is
          refused. Also Portfolio Margin, the margin level a cross-margin account is liquidated at,
          Earn and staking, and sub-accounts. See{' '}
          <Link href="/liquidation-risk">why that matters for ranking</Link>.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, then connect with the key:
        </p>
        <Terminal title="try it">{'tula connect binance'}</Terminal>
        <p className="mt-4 text-dim">
          The same on <Link href="/kraken">Kraken</Link> and <Link href="/coinbase">Coinbase</Link>.{' '}
          <Link href="/security">How keys are kept</Link>.
        </p>
      </Section>
    </Guide>
  )
}
