import type { Metadata } from 'next'
import { Ext } from '@/components/Ext'
import { Cmd, Terminal } from '@/components/Terminal'
import { INSTALL_COMMAND, REPO } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Install tula',
  description:
    'One command. Every release is attested, and the installer refuses a binary it cannot verify.',
}

const CHECKS = [
  ['Published checksum', 'Refuses a download that does not match.'],
  ['Build attestation', 'Sigstore-backed, keyless. Refuses a binary this repo did not build.'],
  ['Versioned installs', '~/.tula/versions, behind a symlink. Going back is a link flip.'],
] as const

const FLAGS = [
  ["--proto '=https'", 'No HTTP downgrade on redirect'],
  ['--tlsv1.2', 'TLS floor'],
  ['-f', 'Fail rather than pipe an error page into a shell'],
] as const

const ENV = [
  ['TULA_VERSION', 'Install an exact version. Pin this in CI.'],
  ['TULA_REQUIRE_ATTESTATION', 'Refuse to install unproven. Needs the GitHub CLI.'],
  ['TULA_INSTALL_DIR', 'Where versions live. Default ~/.tula.'],
  ['TULA_NO_MODIFY_PATH', 'Leave your shell profile alone.'],
  ['TULA_CONFIG_DIR', 'Redirects the credential store.'],
  ['TULA_ETH_RPC', 'Ethereum RPC. Defaults to a public node.'],
  ['TULA_TOKEN_LIST', 'Token Lists URL wallet balances are read against.'],
  ['TULA_PRICE_PAGES', 'Widens CoinGecko coverage past the top 500.'],
  ['ANTHROPIC_API_KEY', 'Enables plain English. Optional.'],
] as const

export default function Page() {
  return (
    <main className="wrap py-16">
      <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium tracking-[-0.025em]">
        Install
      </h1>
      <p className="mb-10 max-w-[36rem] text-[1.05rem] text-dim">
        macOS and Linux, Apple Silicon and x86. One binary, nothing beside it.
      </p>

      <Terminal title="install">{INSTALL_COMMAND}</Terminal>

      {/* A legend for the command directly above, so it sits tight under it —
            justified across the full column reads as two unrelated lists. */}
      <dl className="mt-5 mb-20 grid grid-cols-[auto_1fr] gap-x-7 gap-y-1.5 text-[0.82rem]">
        {FLAGS.map(([flag, why]) => (
          <div key={flag} className="contents">
            <dt className="font-mono text-notice">{flag}</dt>
            <dd className="text-faint">{why}</dd>
          </div>
        ))}
      </dl>

      <p className="label mb-5">
        <span className="text-accent-dim">01</span> Every install is checked
      </p>
      <div className="mb-16 grid gap-px overflow-hidden rounded border border-rule bg-rule sm:grid-cols-3">
        {CHECKS.map(([title, body]) => (
          <div key={title} className="bg-bg px-5 py-5">
            <h3 className="mb-1.5 text-[0.95rem] font-semibold text-ink">{title}</h3>
            <p className="text-[0.88rem] leading-relaxed text-dim">{body}</p>
          </div>
        ))}
      </div>

      <div className="grid min-w-0 items-start gap-12 lg:grid-cols-2">
        <div>
          <p className="label mb-5">
            <span className="text-accent-dim">02</span> First run
          </p>
          <p className="mb-5 text-dim">
            Wallet, Hyperliquid and Aave take a public address. Nothing secret is needed.
          </p>
          <Terminal title="try it">
            <Cmd>tula</Cmd>
            {`

`}
            <span className="text-faint">
              {'# / -> wallet -> connect -> any 0x address\n# then /exposure and /breaks'}
            </span>
          </Terminal>
        </div>

        <div>
          <p className="label mb-5">
            <span className="text-accent-dim">03</span> Other channels
          </p>
          <p className="mb-5 text-dim">The same attested binary, through a package manager.</p>
          <Terminal title="brew · npm">
            {'brew install hsnice16/tap/tula\nnpm install -g @tula/cli'}
          </Terminal>
        </div>
      </div>

      <p className="label mb-5 mt-16">
        <span className="text-accent-dim">04</span> Verify it yourself
      </p>
      <div className="max-w-[46rem]">
        <Terminal title="verify">
          {'gh attestation verify tula-v0.3.0-darwin-arm64.tar.gz --repo hsnice16/tula'}
        </Terminal>
        <p className="mt-4 text-dim">
          A checksum served beside a file only proves it is intact. This proves who built it.
        </p>
      </div>

      <p className="label mb-5 mt-16">
        <span className="text-accent-dim">05</span> Environment
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-[0.89rem]">
          <tbody>
            {ENV.map(([name, does]) => (
              <tr key={name}>
                <td className="w-64 border-b border-rule px-3 py-2.5 align-top">
                  <code className="font-mono text-[0.8rem] text-notice">{name}</code>
                </td>
                <td className="border-b border-rule px-3 py-2.5 align-top text-dim">{does}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-14 text-[0.9rem] text-faint">
        Building from source: <Ext href={`${REPO}/blob/main/CONTRIBUTING.md`}>CONTRIBUTING.md</Ext>
      </p>
    </main>
  )
}
