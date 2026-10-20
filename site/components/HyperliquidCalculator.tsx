'use client'

import { useId, useState } from 'react'
import { NumberField, Readout, SelectField, Toggle } from '@/components/Field'
import {
  maintenanceMargin,
  OPENING,
  PARTIAL_LIQUIDATION,
  perpLiquidationPrice,
  type Side,
  tierAt,
} from '@/lib/calc'
import { dollars, parse, pct, percent, share, usd } from '@/lib/format'
import params from '@/lib/params/hyperliquid.json'

const PERPS = params.perps

const START = OPENING.hyperliquid

type Mode = 'isolated' | 'cross'

/**
 * Hyperliquid's liquidation price for one perp, from the inputs a trader has
 * before opening it — entry, size, leverage — and, for cross margin, what else
 * the account holds.
 */
export function HyperliquidCalculator() {
  const [asset, setAsset] = useState(
    () => (PERPS.find((p) => p.asset === START.asset) ?? PERPS[0])?.asset ?? '',
  )
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [chosenMode, setMode] = useState<Mode>('isolated')
  const [entry, setEntry] = useState(String(START.entry))
  const [mark, setMark] = useState('')
  const [notional, setNotional] = useState(String(START.notional))
  const [leverage, setLeverage] = useState(String(START.leverage))
  const [extra, setExtra] = useState('0')
  const [others, setOthers] = useState('0')

  const perp = PERPS.find((p) => p.asset === asset)
  const isolatedOnly = perp !== undefined && 'isolatedOnly' in perp
  const mode: Mode = isolatedOnly ? 'isolated' : chosenMode

  const e = parse(entry)
  const m = mark.trim() === '' ? e : parse(mark)
  const n = parse(notional)
  const lev = parse(leverage)
  const free = mode === 'cross' ? parse(extra) : 0
  const otherMaintenance = mode === 'cross' ? parse(others) : 0
  const maxLeverage = (perp && tierAt(perp.tiers, n ?? 0)?.maxLeverage) ?? 1

  let problem: string | null = null
  // The field the message is about, so it can say so to a screen reader.
  let fault: 'entry' | 'mark' | 'size' | 'leverage' | 'extra' | 'others' | null = null
  if (!perp) problem = 'Pick an asset.'
  else if (e === null || e <= 0) [problem, fault] = ['Enter an entry price above zero.', 'entry']
  else if (m === null || m <= 0)
    [problem, fault] = ['Enter a mark price above zero, or leave it blank.', 'mark']
  else if (n === null || n <= 0) [problem, fault] = ['Enter a position size above zero.', 'size']
  else if (lev === null || lev < 1) [problem, fault] = ['Leverage starts at 1x.', 'leverage']
  else if (lev > maxLeverage) {
    problem = `${asset} allows at most ${maxLeverage}x on Hyperliquid at this size.`
    fault = 'leverage'
  } else if (free === null)
    [problem, fault] = ['Enter the account’s other USDC as a number, or 0.', 'extra']
  else if (otherMaintenance === null)
    [problem, fault] = ['Enter the other positions’ maintenance, or 0.', 'others']
  const messageId = useId()
  const errorOn = (field: typeof fault) => (fault === field ? messageId : undefined)

  const s: Side = side === 'long' ? 1 : -1
  let result: {
    now: boolean
    price: number | null
    backstop: number | null
    maintenance: number
    size: number
    mark: number
  } | null = null
  if (
    problem === null &&
    perp &&
    e &&
    m &&
    n &&
    lev &&
    free !== null &&
    otherMaintenance !== null
  ) {
    const size = n / e
    const equity = n / lev + s * size * (m - e) + free
    const maintenance = maintenanceMargin(perp.tiers, size * m)
    const input = { side: s, size, mark: m, equity, otherMaintenance, tiers: perp.tiers }
    result = {
      now: equity <= maintenance + otherMaintenance,
      price: perpLiquidationPrice(input),
      backstop: perpLiquidationPrice(input, 2 / 3),
      maintenance,
      size,
      mark: m,
    }
  }

  const headline = result
    ? result.now
      ? 'Liquidatable now: equity is already at or below maintenance.'
      : result.price === null
        ? 'No fall in price liquidates this position.'
        : `Liquidation price ${usd(result.price)}, ${pct((result.price - result.mark) / result.mark)} from the mark.`
    : problem

  return (
    <div className="rounded-[5px] border border-rule bg-panel-2 p-5 shadow-lift">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Asset"
          value={asset}
          onChange={setAsset}
          options={PERPS.map((p) => ({
            value: p.asset,
            label: p.asset,
            note: `max ${p.tiers[0]?.maxLeverage}x`,
          }))}
        />
        <Toggle
          label="Side"
          value={side}
          onChange={setSide}
          options={[
            { value: 'long', label: 'Long' },
            { value: 'short', label: 'Short' },
          ]}
        />
        <Toggle
          label="Margin"
          value={mode}
          onChange={setMode}
          disabled={isolatedOnly ? ['cross'] : undefined}
          options={[
            { value: 'isolated', label: 'Isolated' },
            { value: 'cross', label: 'Cross' },
          ]}
        />
        <NumberField
          label="Leverage"
          error={errorOn('leverage')}
          value={leverage}
          onChange={setLeverage}
          hint={`1–${maxLeverage}x for ${asset}${isolatedOnly ? ', isolated only' : ''}`}
        />
        <NumberField
          label="Entry price (USDC)"
          error={errorOn('entry')}
          value={entry}
          onChange={setEntry}
        />
        <NumberField
          label="Position size (USDC)"
          error={errorOn('size')}
          value={notional}
          onChange={setNotional}
          hint={
            e && n
              ? `${(n / e).toLocaleString('en-US', { maximumSignificantDigits: 6 })} ${asset}`
              : undefined
          }
        />
        <NumberField
          label="Mark price now (optional)"
          error={errorOn('mark')}
          value={mark}
          onChange={setMark}
          hint="Blank means the entry price"
        />
        {mode === 'cross' ? (
          <div className="grid animate-drop grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
            <NumberField
              label="Other USDC in the account"
              error={errorOn('extra')}
              value={extra}
              onChange={setExtra}
              hint="Free balance beyond this position’s margin"
            />
            <NumberField
              label="Maintenance of other positions"
              error={errorOn('others')}
              value={others}
              onChange={setOthers}
              hint="Held fixed: their prices are assumed not to move"
            />
          </div>
        ) : null}
      </div>

      <div className="mt-6 border-t border-rule pt-5">
        {/* One sentence, not the whole panel: every keystroke recomputes it all,
            and a live region that big reads three figures out per character. */}
        <p aria-live="polite" className="sr-only">
          {headline}
        </p>
        {/* Keyed, so each new message and the answer replacing one fade in. */}
        {result === null ? (
          <p key={problem} id={messageId} aria-hidden className="animate-fade text-dim">
            {problem}
          </p>
        ) : (
          <div className="animate-fade">
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Readout
                label="Liquidation price"
                value={result.now ? 'Now' : result.price === null ? 'None' : usd(result.price)}
                note={
                  result.now
                    ? 'Equity is already at or below maintenance'
                    : result.price === null
                      ? 'No fall in price reaches maintenance'
                      : `${pct((result.price - result.mark) / result.mark)} from the mark`
                }
              />
              <Readout
                label="Maintenance margin"
                value={usd(result.maintenance)}
                note={`${percent(result.maintenance / (result.size * result.mark))} of the position`}
              />
              <Readout
                label="Backstop price"
                value={result.now || result.backstop === null ? '—' : usd(result.backstop)}
                note="Equity at 2/3 of maintenance: the liquidator vault takes over"
              />
            </dl>
            {result.size * (result.price ?? result.mark) > PARTIAL_LIQUIDATION.from ? (
              <p className="mt-4 animate-fade text-[0.85rem] text-dim">
                Above {dollars(PARTIAL_LIQUIDATION.from)}, Hyperliquid&rsquo;s first liquidation
                order is for {share(PARTIAL_LIQUIDATION.share)} of the position, so the price above
                is where liquidation starts, not where it ends.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
