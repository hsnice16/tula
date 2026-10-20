import { Ext } from '@/components/Ext'
import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Points, Terms } from '@/components/Prose'
import { Table } from '@/components/Table'
import { Terminal } from '@/components/Terminal'

const PATH = '/crypto-portfolio-tracker-cli'
const TITLE = 'Crypto portfolio trackers for the terminal, compared'
const SUMMARY =
  'Open-source crypto portfolio trackers that run in a terminal — cointop, ticker, cryptgo, Kraken CLI, rotki, hledger and tula — and what each reads, and how.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

const GITHUB = 'https://github.com'

const AT_A_GLANCE = [
  ['cointop', 'Typed in', 'No'],
  ['ticker', 'Typed in', 'No'],
  ['cryptgo', 'Typed in', 'No'],
  ['Kraken CLI', 'Kraken key', 'Kraken only'],
  ['rotki', 'Keys, addresses', 'Not stated'],
  ['hledger, Beancount', 'Journal, CSV', 'No'],
  ['tula', 'Keys, addresses', 'Across venues'],
] as const

/** Each project's own description, cut to what a reader choosing between them needs. */
const TOOLS = [
  [
    <Ext key="cointop" href={`${GITHUB}/cointop-sh/cointop`}>
      cointop
    </Ext>,
    'A full-screen market view in the style of htop: live prices, favourites, charts and alerts. Holdings are typed in by hand.',
  ],
  [
    <Ext key="ticker" href={`${GITHUB}/achannarasappa/ticker`}>
      ticker
    </Ext>,
    'Live stock and crypto quotes with a watchlist, cost-basis lots and gain or loss, written by hand into a config file. Runs on Windows too.',
  ],
  [
    <Ext key="cryptgo" href={`${GITHUB}/Gituser143/cryptgo`}>
      cryptgo
    </Ext>,
    'Prices, coin details, charts and a portfolio page whose amounts are typed in.',
  ],
  [
    <Ext key="kraken-cli" href={`${GITHUB}/krakenfx/kraken-cli`}>
      Kraken CLI
    </Ext>,
    'Kraken’s own client: market data, spot and futures trading, paper trading and an MCP server. The best choice for trading on Kraken; it reads Kraken alone.',
  ],
  [
    <Ext key="rotki" href={`${GITHUB}/rotki/rotki`}>
      rotki
    </Ext>,
    'Portfolio, accounting and tax, from read-only exchange keys and addresses, with deep DeFi decoding. A desktop app or Docker service rather than a terminal tool.',
  ],
  [
    <Ext key="hledger" href="https://hledger.org">
      hledger and Beancount
    </Ext>,
    'Plain-text double-entry accounting, with coins as commodities. Every entry is written or imported; prices come from a price file.',
  ],
] as const

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Terminal trackers"
      title={TITLE}
      heading="Open-source crypto portfolio trackers for the terminal"
      description={SUMMARY}
      lead="Most terminal crypto tools watch prices, and you type in what you hold. A few read your accounts. tula reads them and ranks what liquidates first, across venues."
    >
      <Section title="Which one reads my accounts?">
        <Table head={['Tool', 'Holdings come from', 'Leverage, liquidation']} rows={AT_A_GLANCE} />
        <p className="text-dim">
          A tracker you type holdings into shows what you told it. One that reads a key or an
          address shows what the venue holds, including what you forgot to update.
        </p>
      </Section>

      <Section title="What does each one do?">
        <Terms items={TOOLS} />
      </Section>

      <Section title="When is another tool the better choice?">
        <Points>
          <li>To watch prices, charts and alerts across thousands of coins: cointop or ticker.</li>
          <li>To trade on Kraken from a terminal: Kraken CLI.</li>
          <li>For tax reports and a full transaction history: rotki, or a plain-text ledger.</li>
          <li>For Windows without WSL: ticker.</li>
        </Points>
      </Section>

      <Section title="What does tula do that they do not?">
        <p className="mb-4 text-dim">
          It reads positions rather than prices. From a public address it reads{' '}
          <Link href="/hyperliquid-portfolio-tracker">Hyperliquid</Link>,{' '}
          <Link href="/aave">Aave</Link> and <Link href="/wallets">wallets on nine chains</Link>.
          From a read-only key, it reads <Link href="/kraken">Kraken</Link>,{' '}
          <Link href="/binance">Binance</Link> and <Link href="/coinbase">Coinbase</Link>. Then it
          answers what none of them does:
        </p>
        <Terms
          items={[
            [
              <Link key="exposure" href="/exposure">
                Net exposure
              </Link>,
              'Each asset added up across venues, a short netted against the spot it hedges.',
            ],
            [
              <Link key="risk" href="/liquidation-risk">
                Liquidation risk
              </Link>,
              'Every liquidation price, health factor and account ratio across venues in one list, nearest first.',
            ],
            [
              <Link key="stress" href="/stress-test">
                Stress test
              </Link>,
              'What a fall in any asset does to the whole book, and what it liquidates.',
            ],
          ]}
        />
        <p className="text-dim">
          It has no price charts, no watchlist and no tax reports. It is read-only for the moment,
          and runs on macOS and Linux, or Windows through WSL.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, connect a venue, then:
        </p>
        <Terminal title="try it">{'tula exposure\ntula breaks'}</Terminal>
      </Section>
    </Guide>
  )
}
