import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Terminal } from '@/components/Terminal'

const PATH = '/wallets'
const TITLE = 'Wallet balances across nine EVM chains, one address'
const SUMMARY =
  'Read a public address on Ethereum, Arbitrum, Base and six more chains, counted in net exposure, with no key and no signing.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Wallets"
      title={TITLE}
      heading={TITLE}
      description={SUMMARY}
      lead="One public address is enough. tula reads it on every chain below, and never asks for a key or a seed phrase."
    >
      <Section title="What tula reads">
        <p className="mb-3 text-dim">
          The native gas token — ETH, POL, AVAX and xDAI — and the ERC-20s a token list names, on
          Ethereum, Arbitrum One, Base, Polygon, Optimism, Avalanche, Gnosis, Scroll and Linea.
        </p>
        <p className="text-dim">
          Connect the same address to Aave for its <Link href="/aave">Aave health factor</Link> on
          those chains.
        </p>
      </Section>

      <Section title="Counted as what it is">
        <p className="text-dim">
          WETH counts as ETH in <Link href="/exposure">net exposure</Link>. A bridge’s token, such
          as USDC.e on Polygon, stays its own asset.
        </p>
      </Section>

      <Section title="Not read">
        <p className="text-dim">
          Liquid staking tokens such as stETH and wstETH, what an LP token is a claim on, NFTs,
          Solana, and Hyperliquid’s own EVM chain.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, then:
        </p>
        <Terminal title="try it">{'tula connect wallet\ntula exposure'}</Terminal>
      </Section>
    </Guide>
  )
}
