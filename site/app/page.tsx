import Image, { type StaticImageData } from 'next/image'
import type { ReactNode } from 'react'
import { Ask } from '@/components/Ask'
import { Link } from '@/components/Link'
import { Note } from '@/components/Note'
import { Held, Prompt, Session } from '@/components/Session'
import aaveMark from '@/public/venues/aave.png'
import hyperliquidMark from '@/public/venues/hyperliquid.png'
import krakenMark from '@/public/venues/kraken.png'

// The one book every figure on this page comes from. Synthetic on purpose: real
// balances belong to a real person, and they go stale. src/site-example.test.ts
// recomputes the published numbers from it and fails if they drift.
const SEEN = [
  ['kraken', 'ETH spot', '+4.00'],
  ['hyperliquid', 'ETH perp', '-2.00'],
  ['aave', 'ETH collateral', '+4.64'],
] as const

/**
 * A venue's own mark, inline in a sentence. Height is per-venue because the two
 * glyphs are different shapes — Aave's ghost is twice as wide as it is tall, so
 * matching Hyperliquid's height would make it read as the larger of the two.
 * `font-style` cannot reach an image, so the slant that matches the italic
 * around it has to be a transform.
 */
function Mark({ src, venue, size }: { src: StaticImageData; venue: string; size: string }) {
  return (
    <Image
      src={src}
      alt={venue}
      className={`mr-1.5 inline-block w-auto -skew-x-10 align-middle ${size}`}
    />
  )
}

/**
 * The emphasis a paragraph runs on: a venue's name, the reader's, or the one
 * word its argument turns on. Lifted off the body copy but short of `ink`,
 * which is the heading's weight.
 */
function Named({ children }: { children: ReactNode }) {
  return <em className="font-medium italic text-ink/75">{children}</em>
}

export default function Page() {
  return (
    <main>
      <section className="pt-9 pb-18">
        <div className="wrap py-18">
          <p className="eyebrow mb-6">
            <Note term="Read-only">Only for the moment. Placing trades will come later.</Note>.
            Non-custodial.
          </p>
          <h1 className="mb-5 max-w-[52rem] text-[clamp(2.1rem,5.2vw,3.4rem)] font-medium leading-[1.08] tracking-[-0.025em]">
            <span className="block font-normal text-dim">
              Every venue weighs only what it holds.
            </span>
            tula weighs what you hold.
          </h1>
          <p className="mb-8 max-w-[34rem] text-[1.05rem] italic text-dim">
            Your true exposure, what breaks first, and more, across every venue at once.
          </p>
          <div className="mb-14 flex flex-wrap gap-3">
            <Link className="btn btn-primary" href="/install">
              Install
            </Link>
            <Link className="btn" href="/security">
              Security model
            </Link>
          </div>

          <Session status="4 venues  ·  11 positions  ·  09:14:02 (4s ago)  ·  commands only">
            <Prompt>❯ /exposure</Prompt>
            {`ASSET   NET    NOTIONAL  VENUES                   AS OF
─────  ────  ──────────  ───────────────────────  ─────────────────
ETH    6.64  $16,268.00  kraken hyperliquid aave  09:14:02 (4s ago)
BTC    0.12   $8,160.00  kraken                   09:14:02 (4s ago)
SOL      30   $4,350.00  kraken                   09:14:02 (4s ago)
LINK    180   $2,556.00  wallet                   09:14:02 (4s ago)
USDC   1200   $1,200.00  wallet                   09:14:02 (4s ago)
ARB     900     $558.00  wallet                   09:14:02 (4s ago)
USDT    480     $480.00  kraken                   09:14:02 (4s ago)
OP      320     $464.00  wallet                   09:14:02 (4s ago)
UNI      60     $438.00  wallet                   09:14:02 (4s ago)

`}
            <Held>{'Net value  $34,474.00'}</Held>
            <Prompt>❯ /breaks</Prompt>
            {`VENUE        ASSET  KIND        MOVE TO LIQ  TRIGGER             AS OF
───────────  ─────  ──────────  ───────────  ──────────────────  ─────────────────
aave         ETH    collateral       -27.0%  health factor 1.37  09:14:02 (4s ago)
hyperliquid  ETH    perp             +39.3%  liq price 3412.00   09:14:02 (4s ago)`}
          </Session>
        </div>
      </section>

      {/* Every gap between sections is 13.5rem: each opens on pt-18 and its
          predecessor's bottom padding makes up the rest. The hero reaches it
          with pb-18 over an inner py-18. */}
      <section className="pt-18 pb-36">
        <div className="wrap">
          <p className="label mb-8">The gap it fills</p>
          <div className="grid min-w-0 items-start gap-14 lg:grid-cols-2">
            <div>
              <h2 className="mb-4 text-[clamp(1.4rem,3vw,1.85rem)] font-medium leading-tight tracking-[-0.02em]">
                No venue sees the whole position.
              </h2>
              <p className="text-dim">
                <Named>
                  <Mark src={krakenMark} venue="Kraken" size="h-[0.78em]" />
                  Kraken
                </Named>{' '}
                sees spot ETH and calls it a balance.{' '}
                <Named>
                  <Mark src={hyperliquidMark} venue="Hyperliquid" size="h-[0.8em]" />
                  Hyperliquid
                </Named>{' '}
                sees a perp and its liquidation price.{' '}
                <Named>
                  <Mark src={aaveMark} venue="Aave" size="h-[0.65em]" />
                  Aave
                </Named>{' '}
                sees a health factor and nothing on either side of it.
              </p>
              <p className="mt-4 text-dim">
                Each one is right about its own piece. <Named>Your</Named> real exposure only shows
                up when you read all three together.
              </p>
            </div>

            <div className="overflow-hidden rounded border border-rule bg-panel shadow-lift">
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

      <section className="pt-18 pb-54">
        <div className="wrap">
          <p className="label mb-8">Plain English</p>
          {/* The frame runs the full column rather than half of it, so the
              answer wraps where a terminal would. Half a column is narrower
              than any terminal anybody reads this in, and hand-wrapping to it
              would publish a picture of a width the tool never renders at. */}
          <div className="mb-12 max-w-[42rem]">
            <h2 className="mb-4 text-[clamp(1.4rem,3vw,1.85rem)] font-medium leading-tight tracking-[-0.02em]">
              You can just ask.
            </h2>
            <p className="text-dim">Type a question instead of a command, and tula answers it.</p>
            <p className="mt-4 text-dim">
              Connect a model and the answer comes back in plain English. Every command still works
              without one.
            </p>
          </div>

          <Ask question="what's my real ETH exposure, and what breaks first if ETH drops 20%?">
            {`Net long 6.64 ETH, $16,268.00 across kraken, hyperliquid and aave, as of
09:14:02 (4s ago).

A 20% fall takes the book to $31,220.40, a change of -$3,253.60, and
nothing liquidates. Aave is nearest: a health factor of 1.37 breaks at
-27.0%. The hyperliquid short breaks the other way, +39.3%.`}
          </Ask>
        </div>
      </section>
    </main>
  )
}
