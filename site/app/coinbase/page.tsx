import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Terminal } from '@/components/Terminal'

const PATH = '/coinbase'
const TITLE = 'Coinbase read-only API key (CDP View permission)'
const SUMMARY =
  'Which Coinbase CDP key permission lets a tool read Advanced accounts and perps without trading or moving funds, and what tula refuses.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Coinbase"
      title={TITLE}
      heading="A read-only Coinbase API key"
      description={SUMMARY}
      lead="Coinbase Advanced uses CDP keys with View, Trade and Transfer permissions. To read, keep only View."
    >
      <Section title="The key to create">
        <p className="text-dim">Create a CDP key with only the View permission.</p>
      </Section>

      <Section title="What tula checks">
        <p className="text-dim">
          Coinbase reports which permissions a key has. A key that can trade or transfer is refused.
        </p>
      </Section>

      <Section title="What tula reads">
        <p className="text-dim">
          Every account the key can list, and INTX perpetual futures with the liquidation price
          Coinbase publishes.
        </p>
      </Section>

      <Section title="Not read">
        <p className="text-dim">
          Portfolios other than the key’s own, and CFTC-regulated futures — the US perpetual-style
          contracts on Coinbase Derivatives, which are not the INTX ones above.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, then connect with the key:
        </p>
        <Terminal title="try it">{'tula connect coinbase'}</Terminal>
        <p className="mt-4 text-dim">
          The same on <Link href="/kraken">Kraken</Link> and <Link href="/binance">Binance</Link>.{' '}
          <Link href="/security">How keys are kept</Link>.
        </p>
      </Section>
    </Guide>
  )
}
