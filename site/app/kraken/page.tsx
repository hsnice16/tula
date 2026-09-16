import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Terminal } from '@/components/Terminal'

const PATH = '/kraken'
const TITLE = 'Kraken read-only API key for portfolio tracking'
const SUMMARY =
  'Which Kraken API key permissions to turn on so a tool can read balances but never withdraw, and what tula refuses.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Kraken"
      title={TITLE}
      heading="A read-only Kraken API key"
      description={SUMMARY}
      lead="Kraken lets you pick each permission a key has. To read balances, turn on two."
    >
      <Section title="The key to create">
        <p className="text-dim">
          Create a key with only Query Funds and Query Open Orders & Trades turned on.
        </p>
      </Section>

      <Section title="What tula checks">
        <p className="text-dim">
          Kraken reports the key&rsquo;s whole permission list, from an endpoint that needs no
          permission of its own. A key that can trade or withdraw is refused.
        </p>
      </Section>

      <Section title="What tula reads">
        <p className="text-dim">
          Spot, staked and held balances in every wallet, and open spot-margin positions.
        </p>
      </Section>

      <Section title="Not read">
        <p className="text-dim">
          The account margin level, Kraken Futures positions and drawn credit lines. See{' '}
          <Link href="/liquidation-risk">why that matters for ranking</Link>.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, then connect with the key:
        </p>
        <Terminal title="try it">{'tula connect kraken'}</Terminal>
        <p className="mt-4 text-dim">
          The same on <Link href="/binance">Binance</Link> and{' '}
          <Link href="/coinbase">Coinbase</Link>. <Link href="/security">How keys are kept</Link>.
        </p>
      </Section>
    </Guide>
  )
}
