import { Code } from '@/components/Code'
import { Guide, guideMetadata, Output, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Terminal } from '@/components/Terminal'

const PATH = '/exposure'
const TITLE = 'Net crypto exposure across exchanges and wallets'
const SUMMARY =
  'Spot, perps and collateral netted into one figure per asset across every venue, and an Equity total that never adds a perp’s notional.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Exposure"
      title={TITLE}
      heading="Net crypto exposure across every venue"
      description={SUMMARY}
      lead="Hold ETH on an exchange, short it on Hyperliquid and pledge it on Aave, and each venue shows one piece. tula nets them into one figure."
    >
      <Section title="One figure per asset">
        <p className="mb-4 text-dim">
          <Code>exposure</Code> adds every holding and position in an asset, across venues.
        </p>
        <Output title="tula exposure">
          {`ASSET      NET    NOTIONAL  VENUES                   AS OF
─────  ───────  ──────────  ───────────────────────  ─────────────────
ETH       6.64  $16,268.00  kraken hyperliquid aave  09:14:02 (4s ago)`}
        </Output>
      </Section>

      <Section title="Equity">
        <p className="text-dim">
          The total counts a perp at the profit or loss its venue states, never its notional.
          Hyperliquid calls it Account Equity; Bybit, OKX and Deribit call it equity.
        </p>
      </Section>

      <Section title="Kept apart">
        <p className="text-dim">
          A bridge’s token, such as USDC.e on Polygon, is its own asset. It never nets into Circle’s
          USDC.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          See <Link href="/liquidation-risk">liquidation risk</Link>,{' '}
          <Link href="/hyperliquid">Hyperliquid</Link> and <Link href="/aave">Aave</Link>.{' '}
          <Link href="/install">Install tula</Link>, then:
        </p>
        <Terminal title="try it">{'tula exposure'}</Terminal>
      </Section>
    </Guide>
  )
}
