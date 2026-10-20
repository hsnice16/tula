import { Code } from '@/components/Code'
import { Guide, guideMetadata, Output, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Points, Terms } from '@/components/Prose'
import { Terminal } from '@/components/Terminal'

const PATH = '/hyperliquid-portfolio-tracker'
const TITLE = 'Hyperliquid portfolio tracker by wallet address'
const SUMMARY =
  'Track a Hyperliquid account from its public address: perps, spot and sub-accounts, with PnL, funding and liquidation price, netted with Aave and exchanges.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

const COMMANDS = [
  ['positions', 'Every perp and balance, as Hyperliquid states it, sub-accounts included.'],
  ['position ETH', 'One position in full: entry, PnL, funding, margin and liquidation price.'],
  ['breaks', 'Everything that can be liquidated, nearest first, beside any Aave market.'],
  ['exposure', 'Each asset netted across Hyperliquid and every other venue you connect.'],
] as const

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Hyperliquid tracker"
      title={TITLE}
      heading="Track a Hyperliquid portfolio by address"
      description={SUMMARY}
      lead="Hyperliquid answers anyone who asks about a public address. tula asks, from your terminal, and puts the answer beside the rest of what you hold."
    >
      <Section title="What does it track?">
        <Points>
          <li>
            Perps on Hyperliquid&rsquo;s own dex and every builder-deployed one, with the
            liquidation price or account ratio Hyperliquid states.
          </li>
          <li>Spot balances, staked HYPE and vault equity.</li>
          <li>Every sub-account, as an account of its own.</li>
          <li>
            Standard, unified and portfolio margin accounts, each read the way it liquidates —{' '}
            <Link href="/hyperliquid">how each mode works</Link>.
          </li>
        </Points>
        <p className="text-dim">
          Not read: balances on HyperEVM, Hyperliquid&rsquo;s own EVM chain.
        </p>
      </Section>

      <Section title="Is a wallet address safe to give it?">
        <p className="text-dim">
          An address can only be read. tula never asks for a private key or seed phrase on
          Hyperliquid, and an address can sign nothing. Anyone can look one up on Hyperliquid
          already; tula saves it on your machine, nowhere else. See the{' '}
          <Link href="/security">security model</Link>.
        </p>
      </Section>

      <Section title="One position in full">
        <Output title="tula position ETH">
          {`perp ETH · hyperliquid

Position
  Size             -2 short
  Value            $4,900.00
  Entry Price      $2,500.00
  Mark Price       $2,450.00

PnL
  Unrealised PnL   +$100.00 (ROE +20.4%)
  Funding          $3.20 received since open

Liquidation
  Liq. Price       $3,412.00 (+39.3% to liquidation)
  Margin           $490.00 (10x cross)`}
        </Output>
        <p className="mt-4 text-dim">
          Prices, PnL, funding and the liquidation price are Hyperliquid’s own; tula adds the value
          and the distance to liquidation. To work a liquidation price or funding out by hand first,
          use the{' '}
          <Link href="/hyperliquid-liquidation-calculator">liquidation price calculator</Link> or
          the <Link href="/hyperliquid-funding-calculator">funding rate calculator</Link>.
        </p>
      </Section>

      <Section title="What can I ask it?">
        <Terms
          items={COMMANDS.map(([command, answers]) => [
            <Code key={command}>{command}</Code>,
            answers,
          ])}
        />
      </Section>

      <Section title="Why not Hyperliquid's own portfolio page?">
        <p className="text-dim">
          It shows Hyperliquid. A short there hedging ETH you hold on an exchange, or an Aave loan
          against the same coin, is on another screen. tula nets them into one{' '}
          <Link href="/exposure">net exposure</Link> figure and ranks every{' '}
          <Link href="/liquidation-risk">liquidation risk</Link> in one list, and a{' '}
          <Link href="/stress-test">stress test</Link> shows what a fall does to all of it.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, then paste a public address when it asks:
        </p>
        <Terminal title="try it">{'tula connect hyperliquid\ntula positions'}</Terminal>
      </Section>
    </Guide>
  )
}
