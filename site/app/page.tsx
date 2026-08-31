import Link from 'next/link'
import { Nav } from '@/components/Nav'
import { Cmd, Terminal } from '@/components/Terminal'

const VENUES = [
  ['Wallet', 'Ethereum', 'ETH and ERC-20 holdings', 'a public address'],
  ['Hyperliquid', '', 'perps with liquidation price, spot, margin', 'a public address'],
  ['Aave v3', 'Ethereum', 'collateral, debt, health factor', 'a public address'],
  ['Kraken', '', 'spot and staked balances', 'a query-only key'],
  ['Binance', '', 'spot and futures', 'a read-only key'],
  ['Coinbase Advanced', '', 'spot and held balances', 'a view-only CDP key'],
  ['Stripe', '', 'balances per currency', 'a restricted key'],
  ['Circle Mint', '', 'available and unsettled', 'a restricted key'],
] as const

const REFUSALS = [
  ['Move your money', 'No code path can place an order. The build fails if one appears.'],
  ['Ask for a seed phrase', 'On-chain reads take a public address. No field accepts a key.'],
  ['Do arithmetic in the model', 'Deterministic code computes every figure. The model narrates.'],
  ['Need a model at all', 'Every view has a command behind it. No key required.'],
] as const

const LIMITS = [
  ['Kraken margin and open orders', 'not read'],
  ['Aave', 'Ethereum only'],
  ['Kraken, Binance, Coinbase, Stripe, Circle', 'not run against a live account'],
  ['Assets the price source does not know', 'quantity shown, no notional'],
  ['Alpine and other musl Linux', 'glibc builds only'],
] as const

// The one book every figure on this page comes from. Synthetic on purpose: real
// balances belong to a real person, and they go stale. src/site-example.test.ts
// recomputes the published numbers from it and fails if they drift.
const SEEN = [
  ['kraken', 'ETH spot', '+4.00'],
  ['hyperliquid', 'ETH perp', '-2.00'],
  ['aave', 'ETH collateral', '+4.64'],
] as const

export default function Page() {
  return (
    <>
      <Nav current="/" />

      <section className="relative overflow-hidden border-b border-rule">
        {/* A dot grid, so the empty half of the hero is a surface rather than a void. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-80 [background-image:radial-gradient(var(--color-rule)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_80%_60%_at_70%_40%,#000_30%,transparent_75%)]"
        />
        <div className="wrap relative">
          <div className="grid items-center gap-14 py-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div>
              <p className="eyebrow mb-6">Read-only. Non-custodial. Pre-alpha.</p>
              <h1 className="mb-5 text-[clamp(2.1rem,5.2vw,3.4rem)] font-medium leading-[1.08] tracking-[-0.025em]">
                <span className="block font-normal text-dim">
                  Every venue weighs only what it holds.
                </span>
                Nothing weighs both sides.
              </h1>
              <p className="mb-8 max-w-[30rem] text-[1.05rem] text-dim">
                Your real exposure, and what breaks first, across every venue at once.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link className="btn btn-primary" href="/install">
                  Install
                </Link>
                <Link className="btn" href="/security">
                  Security model
                </Link>
              </div>
            </div>

            <Terminal title="tula">
              <Cmd>$ tula exposure</Cmd>
              {`

ASSET   NET    NOTIONAL  VENUES                   AS OF
─────  ────  ──────────  ───────────────────────  ──────
ETH    6.64  $16,268.00  kraken hyperliquid aave  4s ago
USDC   1200   $1,200.00  wallet                   4s ago
USDT    480     $480.00  kraken                   4s ago

Net value  $17,948.00

`}
              <Cmd>$ tula breaks</Cmd>
              {`

VENUE        ASSET  MOVE TO LIQ  TRIGGER
───────────  ─────  ───────────  ──────────────────
aave         ETH         -27.0%  health factor 1.37
hyperliquid  ETH         +39.3%  liq price 3412.00`}
            </Terminal>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['8', 'venues'],
              ['4', 'domains'],
              ['3', 'need no credential'],
              ['0', 'ways to move your money'],
            ].map(([n, label], i) => (
              <div
                key={label}
                className={`px-6 py-8 ${i > 0 ? 'border-t border-rule lg:border-l lg:border-t-0' : ''}`}
              >
                <dt className="font-mono text-[2.4rem] font-bold leading-none tracking-[-0.02em] text-accent">
                  {n}
                </dt>
                <dd className="mt-2.5 text-[0.82rem] leading-snug text-dim">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="band py-18">
        <div className="wrap">
          <p className="label mb-5">
            <span className="text-accent-dim">01</span> The gap
          </p>
          <div className="grid min-w-0 items-start gap-14 lg:grid-cols-2">
            <div>
              <h2 className="mb-4 text-[clamp(1.4rem,3vw,1.85rem)] font-medium leading-tight tracking-[-0.02em]">
                No venue will ever build this.
              </h2>
              <p className="text-dim">
                Kraken sees Kraken. Aave sees a health factor and nothing either side of it.
                Aggregating across competitors is against every venue&apos;s interest.
              </p>
            </div>

            <div className="overflow-hidden rounded border border-rule bg-panel">
              <p className="border-b border-rule px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-faint">
                One asset, three venues
              </p>
              {SEEN.map(([venue, what, qty]) => (
                <div
                  key={venue}
                  className="flex items-baseline justify-between gap-4 border-b border-rule-soft px-4 py-3.5 font-mono text-[0.82rem]"
                >
                  <span className="flex-none tracking-[0.04em] text-faint">{venue}</span>
                  <span className="text-right text-dim">
                    {what} <b className="font-semibold text-ink">{qty}</b>
                  </span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 border-t border-accent-dim bg-panel-2 px-4 py-3.5 font-mono text-[0.82rem]">
                <span className="flex-none font-bold tracking-[0.04em] text-accent">tula</span>
                <span className="text-right text-dim">
                  net ETH <b className="font-semibold text-accent">6.64</b>,{' '}
                  <b className="font-semibold text-accent">-27.0%</b> to liquidation
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="band py-18">
        <div className="wrap">
          <p className="label mb-5">
            <span className="text-accent-dim">02</span> What it reads
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-[0.89rem]">
              <thead>
                <tr>
                  {['Venue', 'Reads', 'Needs'].map((h) => (
                    <th
                      key={h}
                      className="border-b border-rule px-3 py-2.5 text-left font-mono text-[0.68rem] font-normal uppercase tracking-[0.12em] text-faint"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VENUES.map(([name, chain, reads, needs]) => (
                  <tr key={name}>
                    <td className="border-b border-rule px-3 py-2.5 align-top">
                      <strong className="font-semibold text-ink">{name}</strong>
                      {chain ? <span className="text-dim"> {chain}</span> : null}
                    </td>
                    <td className="border-b border-rule px-3 py-2.5 align-top text-dim">{reads}</td>
                    <td className="border-b border-rule px-3 py-2.5 align-top text-dim">{needs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-5 text-[0.9rem] text-faint">
            Priced by CoinGecko, CoinMarketCap, CryptoCompare or CoinPaprika — one at a time.
          </p>
        </div>
      </section>

      <section className="band py-18">
        <div className="wrap">
          <p className="label mb-5">
            <span className="text-accent-dim">03</span> What it does not do
          </p>
          <div className="grid gap-px overflow-hidden rounded border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
            {REFUSALS.map(([title, body]) => (
              <div key={title} className="bg-bg px-5 py-5">
                <h3 className="mb-1.5 text-[0.95rem] font-semibold text-ink">{title}</h3>
                <p className="text-[0.88rem] leading-relaxed text-dim">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6">
            <Link href="/security">How each one is enforced</Link>
          </p>
        </div>
      </section>

      <section className="band py-18">
        <div className="wrap">
          <p className="label mb-5">
            <span className="text-accent-dim">04</span> What it does not read yet
          </p>
          <dl className="max-w-[46rem]">
            {LIMITS.map(([claim, state]) => (
              <div
                key={claim}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule-soft py-3 last:border-b-0"
              >
                <dt className="text-ink">{claim}</dt>
                <dd className="font-mono text-[0.8rem] text-faint">{state}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  )
}
