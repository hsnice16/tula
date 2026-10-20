import { Code } from '@/components/Code'
import { Ext } from '@/components/Ext'
import { Guide, guideMetadata, Output, Section } from '@/components/Guide'
import { Link } from '@/components/Link'
import { Points, Steps } from '@/components/Prose'
import { Terminal } from '@/components/Terminal'

const PATH = '/binance'
const TITLE = 'Binance read-only API key: step by step'
const SUMMARY =
  'Create a Binance API key that can only read: which key type to pick, the one restriction to tick, IP rules, and why tula refuses a key that can move funds.'

export const metadata = guideMetadata(PATH, TITLE, SUMMARY)

/** Binance's own labels, so a reader can match each row to a checkbox. */
const RESTRICTIONS = [
  ['Enable Reading', 'On', 'Balances and margin positions. The only box tula needs.'],
  ['Enable Spot & Margin Trading', 'Off', 'Places spot and margin orders. Refused as trading.'],
  [
    'Enable Futures',
    'Off',
    'Trades futures. Binance has no read-only futures permission. Refused as trading.',
  ],
  [
    'Enable Withdrawals',
    'Off',
    'Sends crypto off Binance. Needs an IP restriction to tick. Refused.',
  ],
  [
    'Enable Margin Loan, Repay & Transfer',
    'Off',
    'Borrows against your account and moves funds into margin. Not a way to read margin. Refused.',
  ],
  ['Enable Internal Transfer', 'Off', 'Moves funds to another account. Refused.'],
  ['Permits Universal Transfer', 'Off', 'Moves funds between your wallets. Refused.'],
] as const

export default function Page() {
  return (
    <Guide
      path={PATH}
      label="Binance"
      title={TITLE}
      heading="How to create a read-only Binance API key"
      description={SUMMARY}
      lead="Binance keys come with restrictions you tick. To read, tick one: Enable Reading."
    >
      <Section title="Create the key in API Management">
        <p className="mb-4 text-dim">
          Create a key with only Enable Reading turned on. Binance asks for 2FA, identity
          verification and a deposit in your Spot Wallet before it issues one.
        </p>
        <Steps>
          <li>
            On the website, click the profile icon, then <Code>Account</Code> and{' '}
            <Code>API Management</Code>. In the app: <Code>More</Code>, then{' '}
            <Code>API Management</Code> under Other.
          </li>
          <li>
            Click <Code>Create API</Code> and choose <Code>System generated</Code>. tula signs with
            HMAC, which is that type; a self-generated Ed25519 or RSA key will not work with it.
          </li>
          <li>Label it, such as tula, and confirm with your 2FA device or passkey.</li>
          <li>
            Copy the API Key and the Secret Key now. Binance shows the secret only when the key is
            created and masks it after. Lost it? Delete the key and create another.
          </li>
          <li>
            In the key&rsquo;s API restrictions, leave only <Code>Enable Reading</Code> ticked.
          </li>
        </Steps>
      </Section>

      <Section title="Binance API restrictions: one on, the rest off">
        <Points>
          {RESTRICTIONS.map(([name, verdict, does]) => (
            <li key={name}>
              <Code>{name}</Code>: <span className="text-ink">{verdict}.</span> {does}
            </li>
          ))}
        </Points>
        <p className="mt-4 text-dim">Any box not listed here: leave it off too.</p>
      </Section>

      <Section title="How tula checks a Binance key before saving it">
        <p className="mb-4 text-dim">
          It reads <Code>/sapi/v1/account/apiRestrictions</Code>, where Binance reports every box as
          on or off. A key that can trade, withdraw or move your funds is refused. A key without
          Enable Reading is refused too. Every answer is proven, so nothing is left as unknown, and
          nothing is written to disk until the check passes.
        </p>
        <Output title="a transfer key, refused">
          {
            'Verifying key scope... failed.\nRefusing this key: it can move your funds. Turn off Enable Internal Transfer\n  on the key, or make a new one with Enable Reading only, then connect again.\n  "Enable Margin Loan, Repay & Transfer" is a borrowing power, not a way to read margin.'
          }
        </Output>
      </Section>

      <Section title="Can a read-only Binance API key withdraw funds?">
        <p className="text-dim">
          No. Withdrawing needs Enable Withdrawals, and Binance will not tick it on a key without an
          IP restriction. Trading needs a trading box. What a reading key does expose is your data —
          balances and positions — so treat it like a password.{' '}
          <Link href="/security">How tula keeps it</Link>.
        </p>
      </Section>

      <Section title="Does a read-only Binance key need an IP restriction?">
        <p className="mb-3 text-dim">
          No. Binance limits a system-generated key with unrestricted IP access to reading, and has
          since 30 January 2023 — so unrestricted is the setting that fits a read-only key. An IPv4
          restriction is what Binance requires before it allows withdrawals.
        </p>
        <p className="text-dim">
          tula calls Binance from your machine. Restrict the key to your IP only if it is fixed: on
          home broadband, a VPN or a laptop it changes, and every call then fails.
        </p>
      </Section>

      <Section title="Why tula cannot read your Binance futures">
        <p className="text-dim">
          Binance&rsquo;s futures permission grants futures trading, and there is no read-only one,
          so a key that could read futures is refused before it is stored. Portfolio Margin is
          unread for the same reason.
        </p>
      </Section>

      <Section title="What tula reads, and what it does not">
        <p className="mb-3 text-dim">
          Spot balances, free and locked stated apart, and cross and isolated margin with the
          liquidation price each isolated pair carries.
        </p>
        <p className="text-dim">
          Not read: futures, Portfolio Margin, the margin level a cross-margin account is liquidated
          at, the Funding wallet, Earn and staking, loans, and sub-account balances. See{' '}
          <Link href="/liquidation-risk">why that matters for ranking</Link>.
        </p>
      </Section>

      <Section title="Try it">
        <p className="mb-4 text-dim">
          <Link href="/install">Install tula</Link>, then connect with the key:
        </p>
        <Terminal title="try it">{'tula connect binance'}</Terminal>
        <p className="mt-4 text-dim">
          Binance&rsquo;s own guide:{' '}
          <Ext href="https://www.binance.com/en/support/faq/detail/360002502072">
            how to create API keys
          </Ext>
          . The same on <Link href="/kraken">Kraken</Link> and{' '}
          <Link href="/coinbase">Coinbase</Link>.
        </p>
      </Section>
    </Guide>
  )
}
