import { Code } from '@/components/Code'
import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Terminal } from '@/components/Terminal'

const PATH = '/hyperliquid'
const TITLE = 'Hyperliquid liquidation price and margin ratio'
const SUMMARY =
  'How Hyperliquid liquidates a position or a whole account, and how tula reads every account mode, builder dex and sub-account.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Hyperliquid"
      title={TITLE}
      heading={TITLE}
      description={SUMMARY}
      lead="Hyperliquid liquidates a position or a whole account, depending on the account mode. tula reads which one applies."
    >
      <Section title="How Hyperliquid liquidates">
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Standard.</strong> Each position liquidates at
          its own price.
        </p>
        <p className="mb-3 text-dim">
          <strong className="font-semibold text-ink">Unified account.</strong> The whole account is
          at risk once its Unified Account Ratio passes 95%, in Hyperliquid&rsquo;s own words.
        </p>
        <p className="text-dim">
          <strong className="font-semibold text-ink">Portfolio margin.</strong> Hyperliquid
          documents the account as liquidatable once its Portfolio Margin Ratio passes 95%.
        </p>
      </Section>

      <Section title="What tula reads">
        <p className="mb-3 text-dim">
          The account mode and its balances, perps on every builder-deployed dex, staked HYPE and
          every sub-account, all counted in <Link href="/exposure">net exposure</Link>. Vault equity
          counts in the total but not in net exposure: it is a claim on a pool, not the coin.
        </p>
        <p className="text-dim">
          Under unified or portfolio margin, <Code>breaks</Code> ranks the whole account on its
          ratio. See <Link href="/liquidation-risk">liquidation risk across venues</Link>.
        </p>
      </Section>

      <Section title="When a dex does not load">
        <p className="text-dim">
          The unified ratio shows as “at least” the figure over the dexes that did load, and the one
          that did not is named.
        </p>
      </Section>

      <Section title="Not read">
        <p className="text-dim">Balances on HyperEVM, Hyperliquid’s own EVM chain.</p>
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
