import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { Guide, guideMetadata, Output, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Points, Steps } from '@/components/Prose'
import { Terminal } from '@/components/Terminal'

const PATH = '/kraken'
const TITLE = 'Kraken read-only API key: step by step'
const SUMMARY =
  'Create a Kraken API key that can only read: the two permissions to tick, the ones to leave off, IP whitelisting, and how tula checks the key before saving it.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

/** Kraken's own labels, so a reader can match each row to a checkbox. */
const PERMISSIONS = [
  ['Query Funds', 'On', 'Balances in every wallet. Without it there is nothing to read.'],
  [
    'Query Open Orders & Trades',
    'On',
    'Open spot-margin positions. A query permission; it cannot place an order.',
  ],
  ['Create & Modify Orders', 'Off', 'Places and edits orders. tula refuses the key.'],
  ['Cancel/Close Orders', 'Off', 'Closes positions, which is a trade. tula refuses the key.'],
  ['Withdraw Funds', 'Off', 'Moves funds off Kraken. tula refuses the key.'],
  [
    'Deposit Funds, Earn, Export Data, Query Ledger Entries, Query Closed Orders & Trades, Access WebSocket API',
    'Off',
    'Not read. Earn allocates funds into and out of staking.',
  ],
] as const

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Kraken"
      title={TITLE}
      heading="How to create a read-only Kraken API key"
      description={SUMMARY}
      lead="Kraken lets you pick each permission a key has. To read balances and positions, turn on two and leave the rest off."
    >
      <Section title="Create the key in Kraken Pro">
        <p className="mb-4 text-dim">
          Create a key with only Query Funds and Query Open Orders & Trades turned on. In Kraken
          Pro:
        </p>
        <Steps>
          <li>
            Sign in to Kraken Pro, click the profile icon in the top-right corner and choose{' '}
            <Code>Settings</Code>.
          </li>
          <li>
            Open the <Code>API</Code> tab and click <Code>Create API key</Code>.
          </li>
          <li>Give it a description you will recognise, such as tula. It must be unique.</li>
          <li>
            Turn on <Code>Query Funds</Code> and <Code>Query Open Orders & Trades</Code>. Leave
            every other box off.
          </li>
          <li>
            Optionally set <Code>IP whitelisting</Code> and <Code>Key Expiration</Code>, then click{' '}
            <Code>Generate key</Code>.
          </li>
          <li>
            Copy the API key and the private key now. Kraken shows the private key once, and editing
            the key later does not show it again. Lost it? Delete the key and make a new one.
          </li>
        </Steps>
        <p className="mt-4 text-dim">
          Give tula a key of its own — Kraken needs each call&rsquo;s nonce to be higher than the
          last, and two programs sharing a key trip over each other.
        </p>
      </Section>

      <Section title="Which Kraken permissions to tick, and which to leave off">
        <Points>
          {PERMISSIONS.map(([name, verdict, does]) => (
            <li key={name}>
              <Code>{name}</Code>: <span className="text-ink">{verdict}.</span> {does}
            </li>
          ))}
        </Points>
      </Section>

      <Section title="How tula checks a Kraken key before saving it">
        <Steps>
          <li>
            It reads <Code>Balance</Code>. A key that cannot is turned away.
          </li>
          <li>
            It reads <Code>OpenPositions</Code>. A key without Query Open Orders & Trades is turned
            away: it would report a leveraged book as one nothing can liquidate.
          </li>
          <li>
            It asks <Code>GetApiKeyInfo</Code>, which lists every permission the key holds and needs
            none of its own. A key that can trade or withdraw is refused.
          </li>
          <li>
            If Kraken does not answer that, it calls <Code>WithdrawMethods</Code>, which only lists
            methods but is gated on Withdraw Funds — so a success proves the power. Trading cannot
            be probed without an order endpoint, which tula does not have, so it connects and says
            it could not confirm the key cannot trade.
          </li>
        </Steps>
        <p className="mb-4 text-dim">Nothing is written to disk until every check passes.</p>
        <Output title="a trading key, refused">
          {
            'Verifying key scope... done.\n\nRefused: this key can trade. tula will not hold a key that can move your funds.\nCreate a key with only Query Funds and Query Open Orders & Trades turned on.'
          }
        </Output>
      </Section>

      <Section title="Can a read-only Kraken API key withdraw or trade?">
        <p className="text-dim">
          No. Kraken checks every private call against the key&rsquo;s permissions, so without
          Withdraw Funds or Create & Modify Orders those calls fail. What the key does expose is
          your data: balances, positions and open orders. Treat it like a password —{' '}
          <Link href="/security">how tula keeps it</Link>.
        </p>
      </Section>

      <Section title="Should a Kraken read-only key be IP whitelisted?">
        <p className="text-dim">
          Kraken recommends restricting production keys to known IP addresses. tula runs on your
          machine, so the address is your connection&rsquo;s. On a fixed IP, whitelist it. On home
          broadband, a VPN or a laptop, it changes, and every call then fails until you edit the
          list. Key Expiration is the other way to bound a key you might forget.
        </p>
      </Section>

      <Section title="Kraken Futures needs a different key">
        <p className="text-dim">
          Kraken Futures is a separate product with separate API keys, created in its own settings.
          tula asks for a Spot key only, so it does not read Kraken Futures positions.
        </p>
      </Section>

      <Section title="What tula reads, and what it does not">
        <p className="mb-3 text-dim">
          Spot, staked and held balances in every wallet, and open spot-margin positions.
        </p>
        <p className="text-dim">
          Not read: the account margin level, Kraken Futures positions and drawn credit lines. See{' '}
          <Link href="/liquidation-risk">why that matters for ranking</Link>.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, then connect with the key:
        </p>
        <Terminal title="try it">{'tula connect kraken'}</Terminal>
        <p className="mt-4 text-dim">
          Kraken&rsquo;s own guides:{' '}
          <Ext href="https://support.kraken.com/articles/360000919966-how-to-create-an-api-key">
            creating a key
          </Ext>{' '}
          and{' '}
          <Ext href="https://docs.kraken.com/exchange/guides/rest/api-keys">
            what each permission allows
          </Ext>
          . The same on <Link href="/binance">Binance</Link> and{' '}
          <Link href="/coinbase">Coinbase</Link>.
        </p>
      </Section>
    </Guide>
  )
}
