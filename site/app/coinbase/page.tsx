import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { Guide, guideMetadata, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Points, Steps } from '@/components/Prose'
import { Terminal } from '@/components/Terminal'

const PATH = '/coinbase'
const TITLE = 'Coinbase read-only API key: CDP View permission'
const SUMMARY =
  'Create a Coinbase CDP API key that can only read: tick View, leave Trade and Transfer off, pick ECDSA, and see how tula checks the key before saving it.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

const PERMISSIONS = [
  ['View', 'On', 'Accounts, balances and positions. The only permission tula needs.'],
  ['Trade', 'Off', 'Places buy and sell orders, and converts. tula refuses the key.'],
  [
    'Transfer',
    'Off',
    'Sends and receives funds, on and off Coinbase, and between portfolios. tula refuses the key.',
  ],
] as const

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Coinbase"
      title={TITLE}
      heading="How to create a read-only Coinbase API key"
      description={SUMMARY}
      lead="Coinbase Advanced uses CDP keys with View, Trade and Transfer permissions. To read, keep only View."
    >
      <Section title="Create a CDP key on the Coinbase Developer Platform">
        <p className="mb-4 text-dim">
          Create a CDP key with only the View permission. Sign in to the Coinbase Developer Platform
          with your Coinbase account, then:
        </p>
        <Steps>
          <li>
            Open <Code>API Keys</Code>, then <Code>Secret API Keys</Code>, and click to create a
            key.
          </li>
          <li>Give it a nickname, such as tula.</li>
          <li>
            Expand <Code>API restrictions</Code>. Pick the portfolio the key should read, and tick{' '}
            <Code>View</Code> only.
          </li>
          <li>
            Expand <Code>Advanced Settings</Code> and set the signature algorithm to{' '}
            <Code>ECDSA</Code>. Coinbase says Ed25519 is not supported by its Coinbase App APIs.
          </li>
          <li>Optionally add your IP address to the allowlist, then create the key.</li>
          <li>
            Copy the key name and the private key from the dialog, or click{' '}
            <Code>Download API key</Code>. The file is no longer saved automatically.
          </li>
        </Steps>
      </Section>

      <Section title="View, Trade and Transfer: what each one allows">
        <Points>
          {PERMISSIONS.map(([name, verdict, does]) => (
            <li key={name}>
              <Code>{name}</Code>: <span className="text-ink">{verdict}.</span> {does}
            </li>
          ))}
        </Points>
        <p className="mt-4 text-dim">If the form offers any other permission, leave it off.</p>
      </Section>

      <Section title="How tula checks a Coinbase key before saving it">
        <p className="mb-3 text-dim">
          It calls <Code>/api/v3/brokerage/key_permissions</Code>, where Coinbase reports{' '}
          <Code>can_view</Code>, <Code>can_trade</Code> and <Code>can_transfer</Code> for the key. A
          key that can trade or transfer is refused. A key without View is refused too. Every answer
          is proven, and nothing is written to disk until the check passes.
        </p>
        <p className="text-dim">
          The private key is the only one tula loads, and it is used to sign read requests and
          nothing else. tula asks for the key name and the whole private key, BEGIN and END lines
          included — never a wallet key or a seed phrase.
        </p>
      </Section>

      <Section title="Can a View-only Coinbase API key send crypto?">
        <p className="text-dim">
          No. Sending, receiving and moving funds between portfolios all need Transfer, and orders
          need Trade. A View key can read your balances and positions, which is still your financial
          data — treat it like a password. <Link href="/security">How tula keeps it</Link>.
        </p>
      </Section>

      <Section title="Legacy Coinbase API keys no longer work">
        <p className="text-dim">
          Coinbase expired every legacy API key in February 2025, and Coinbase Pro keys never worked
          with Advanced Trade. A key with a 16-character name is a legacy one: make a CDP key
          instead.
        </p>
      </Section>

      <Section title="One Coinbase key reads one portfolio">
        <p className="text-dim">
          Coinbase ties each CDP key to the portfolio chosen when it was made, so portfolios other
          than that one are not read. To include another, make a View key for it and connect that
          too; tula adds it to the same venue.
        </p>
      </Section>

      <Section title="What tula reads, and what it does not">
        <p className="mb-3 text-dim">
          Every account the key can list, free and held stated apart, and perpetual futures on
          Coinbase International Exchange, outside the US, with the liquidation price Coinbase
          publishes.
        </p>
        <p className="text-dim">
          Not read: portfolios other than the key&rsquo;s own, and CFTC-regulated futures — the US
          contracts on Coinbase Derivatives, perpetual-style ones included. See{' '}
          <Link href="/liquidation-risk">why that matters for ranking</Link>.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, then connect with the key:
        </p>
        <Terminal title="try it">{'tula connect coinbase'}</Terminal>
        <p className="mt-4 text-dim">
          Coinbase&rsquo;s own guide:{' '}
          <Ext href="https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication">
            creating an API key
          </Ext>
          . The same on <Link href="/kraken">Kraken</Link> and <Link href="/binance">Binance</Link>.
        </p>
      </Section>
    </Guide>
  )
}
