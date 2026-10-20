import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Points, Terms } from '@/components/Prose'
import { Table } from '@/components/Table'
import { Terminal } from '@/components/Terminal'

const PATH = '/wallets'
const TITLE = 'Check token balances across EVM chains by address'
const SUMMARY =
  'Look up native and ERC-20 token balances for one public address on Ethereum, Arbitrum, Base and six more EVM chains, with no key and no signing.'

/** Chain, its gas token, and the token list its ERC-20s are found from. */
const CHAINS = [
  ['Ethereum', 'ETH', 'Uniswap'],
  ['Arbitrum One', 'ETH', 'Uniswap'],
  ['Base', 'ETH', 'Uniswap'],
  ['Polygon', 'POL', 'Uniswap'],
  ['Optimism', 'ETH', 'Uniswap'],
  ['Avalanche', 'AVAX', 'Uniswap'],
  ['Gnosis', 'xDAI', 'SmolDapp'],
  ['Scroll', 'ETH', 'SmolDapp'],
  ['Linea', 'ETH', 'SmolDapp'],
]

const HOW = [
  ['Gas token', 'The chain’s own balance call, eth_getBalance, on any node.'],
  ['ERC-20', 'Each token contract’s balanceOf, asked about the address.'],
  [
    'Which tokens',
    'A node cannot list every token an address holds, so a token list names the ones to ask about.',
  ],
] as const

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Wallets"
      title={TITLE}
      heading="Token balances across nine EVM chains, from one address"
      description={SUMMARY}
      lead="One public address is enough. tula reads it on every chain below, and never asks for a key or a seed phrase."
    >
      <Section title="How do you check a wallet’s balances by address?">
        <p className="mb-4 text-dim">
          Every balance on an EVM chain is public. Reading one takes the address and nothing else:
        </p>
        <Terms items={HOW} />
      </Section>

      <Section title="The chains, and the gas token on each">
        <Table head={['Chain', 'Gas token', 'Token list']} rows={CHAINS} />
        <p className="mt-4 text-dim">
          The native gas token — ETH, POL, AVAX and xDAI — and the ERC-20s a{' '}
          <Ext href="https://tokenlists.org/">token list</Ext> names, on each. Public nodes are used
          by default; set <Code>TULA_ETHEREUM_RPC</Code>, <Code>TULA_BASE_RPC</Code> and the like to
          use your own, and <Code>TULA_TOKEN_LIST</Code> for another list.
        </p>
      </Section>

      <Section title="One address, one row per chain">
        <p className="text-dim">
          <Code>positions</Code> shows each chain apart: Ethereum as <Code>wallet</Code>, the rest
          as <Code>wallet-arbitrum</Code>, <Code>wallet-base</Code> and so on. <Code>exposure</Code>{' '}
          adds them into one figure per asset.
        </p>
      </Section>

      <Section title="Why is a token missing?">
        <Points>
          <li>It is not on the token list, so nothing asks about it.</li>
          <li>It is a liquid staking or yield-bearing token the default list does not carry.</li>
          <li>It sits on a chain outside the nine above.</li>
          <li>A node did not answer; the chain is named as failed, not shown as empty.</li>
        </Points>
      </Section>

      <Section title="Is it safe to enter an address?">
        <p className="text-dim">
          An address is public already: anyone can read its balances. It cannot sign or move
          anything, and the wallet connector asks for nothing else.{' '}
          <Link href="/security">How tula handles keys</Link>.
        </p>
      </Section>

      <Section title="Counted as what it is">
        <Points>
          <li>
            WETH counts as ETH in <Link href="/exposure">net exposure</Link>, where it is the
            chain’s own wrap of ether.
          </li>
          <li>A bridge’s token, such as USDC.e on Polygon, stays its own asset.</li>
          <li>
            Aave’s receipt and debt tokens are skipped: the Aave read already counts what they stand
            for. Connect the same address to Aave for its{' '}
            <Link href="/aave">Aave health factor</Link> on those chains.
          </li>
        </Points>
      </Section>

      <Section title="What tula does not read">
        <p className="text-dim">
          By default, liquid staking and yield-bearing tokens such as stETH, wstETH and sUSDe, which
          the default lists do not carry; <Code>TULA_TOKEN_LIST</Code> can name them. Never: what an
          LP token is a claim on, NFTs, Solana, and Hyperliquid’s own EVM chain.
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
