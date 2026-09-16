import { Code } from '@/components/Code'
import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Terminal } from '@/components/Terminal'

const PATH = '/aave'
const TITLE = 'Aave health factor and distance to liquidation'
const SUMMARY =
  'How far Aave collateral can fall before the health factor reaches 1, across twelve Aave v3 markets on nine chains, from one public address.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Aave"
      title={TITLE}
      heading={TITLE}
      description={SUMMARY}
      lead="Aave liquidates a position once its health factor falls below 1. tula turns the health factor into how far prices can fall first."
    >
      <Section title="From health factor to price move">
        <p className="text-dim">
          At a health factor of HF, the collateral can fall 1 − 1/HF before the market is
          liquidatable. At 2 that is 50%. At 1.37, about 27%.
        </p>
      </Section>

      <Section title="What tula reads">
        <p className="mb-3 text-dim">
          Collateral, debt and each market’s health factor, across twelve markets on Ethereum,
          Arbitrum One, Base, Polygon, Optimism, Avalanche, Gnosis, Scroll and Linea, from one
          address.
        </p>
        <p className="text-dim">
          Each market’s own liquidation thresholds, and its eMode category’s where the account is in
          one. All of it counts in <Link href="/exposure">net exposure</Link>.
        </p>
      </Section>

      <Section title="Ask what if">
        <p className="mb-4 text-dim">
          <Code>shock</Code> reprices the book and shows each new health factor. See{' '}
          <Link href="/liquidation-risk">liquidation risk across venues</Link>.
        </p>
        <Terminal title="shock">{'tula shock ETH -20'}</Terminal>
      </Section>

      <Section title="Not read">
        <p className="text-dim">
          Aave V4, Umbrella and the legacy Safety Module, isolation mode, and other chains.
        </p>
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
