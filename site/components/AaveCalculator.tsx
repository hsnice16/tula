'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { NumberField, PanelLabel, Readout, SelectField } from '@/components/Field'
import {
  CLOSE_FACTOR_HF_THRESHOLD,
  CLOSE_FACTOR_RESERVE_FLOOR,
  type Collateral,
  collateralLiquidationPrice,
  dropToLiquidation,
  healthFactor,
  OPENING,
} from '@/lib/calc'
import { dollars, parse, pct, share, usd } from '@/lib/format'
import params from '@/lib/params/aave.json'

const MARKETS = params.markets

type Market = (typeof MARKETS)[number]
type Category = Market['emodes'][number]

interface Row {
  id: number
  /** The reserve's name, unique within its market. */
  reserve: string
  amount: string
  price: string
}

/**
 * What a row can hold: the market's reserves, and any its eMode category admits
 * that the market's list drops — a zero threshold outside the category, or paused.
 */
function choices(market: Market | undefined, category: Category | undefined) {
  const listed = market?.reserves ?? []
  const extra = (category?.collateral ?? []).filter((c) => !listed.some((r) => r.asset === c))
  return [...listed, ...extra.map((asset) => ({ asset, threshold: 0, existingOnly: false }))]
}

/** The same reserve if it is still a choice, else the fallback, else the first. */
function keep(reserve: string, options: { asset: string }[], fallback = '') {
  const has = (name: string) => options.some((o) => o.asset === name)
  return has(reserve) ? reserve : has(fallback) ? fallback : (options[0]?.asset ?? '')
}

const CORE = MARKETS[0]
const START = choices(CORE, undefined)
const OPEN = OPENING.aave

/**
 * Aave v3's health factor for a set of collateral against a debt, the move that
 * liquidates it, and the price of each collateral asset at which it does.
 * Prices are typed in, because nothing here is fetched.
 */
export function AaveCalculator() {
  const [market, setMarket] = useState(CORE?.name ?? '')
  const [emode, setEmode] = useState('0')
  const [rows, setRows] = useState<Row[]>([
    {
      id: 1,
      reserve: keep('', START, OPEN.asset),
      amount: String(OPEN.amount),
      price: String(OPEN.price),
    },
  ])
  const [debt, setDebt] = useState(String(OPEN.debt))

  const m = MARKETS.find((x) => x.name === market)
  const category = m?.emodes.find((e) => String(e.id) === emode)
  const options = choices(m, category)

  /** In an eMode category, its own collateral takes the category's threshold, and nothing else does. */
  const thresholdOf = (reserve: string) =>
    category?.collateral.includes(reserve)
      ? category.threshold
      : (m?.reserves.find((r) => r.asset === reserve)?.threshold ?? 0)

  const remap = (next: ReturnType<typeof choices>) =>
    setRows((rs) => rs.map((r) => ({ ...r, reserve: keep(r.reserve, next) })))
  const changeMarket = (name: string) => {
    setMarket(name)
    setEmode('0')
    remap(
      choices(
        MARKETS.find((x) => x.name === name),
        undefined,
      ),
    )
  }
  const changeEmode = (id: string) => {
    setEmode(id)
    remap(
      choices(
        m,
        m?.emodes.find((e) => String(e.id) === id),
      ),
    )
  }
  const edit = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set())
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const adder = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
    }
  }, [])
  const remove = (id: number) => {
    const drop = () => {
      timers.current.delete(id)
      setRows((rs) => rs.filter((x) => x.id !== id))
      setLeaving((ids) => new Set([...ids].filter((x) => x !== id)))
      // The pressed button leaves with its row, and focus would fall to the page.
      adder.current?.focus()
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return drop()
    if (timers.current.has(id)) return
    setLeaving((ids) => new Set(ids).add(id))
    timers.current.set(id, setTimeout(drop, 150))
  }
  const add = () =>
    setRows((rs) => [
      ...rs,
      {
        id: Math.max(0, ...rs.map((r) => r.id)) + 1,
        reserve: keep('', options, 'USDC'),
        amount: '',
        price: '1',
      },
    ])

  const priced = rows.map((r) => {
    const amount = parse(r.amount)
    const price = parse(r.price)
    return amount !== null && price !== null && price > 0
      ? { value: amount * price, price, threshold: thresholdOf(r.reserve) }
      : null
  })
  const collateral = priced.filter((c): c is Collateral => c !== null)
  const d = parse(debt)
  const complete = collateral.length === rows.length && d !== null
  const hf = complete ? healthFactor(collateral, d) : null

  // Typed but unreadable, not merely empty: a new row starts empty, and calling
  // that wrong before anything is typed would be the page's fault, not theirs.
  const messageId = useId()
  const errorOn = (text: string, positive = false) => {
    const n = parse(text)
    return text.trim() !== '' && (n === null || (positive && n <= 0)) ? messageId : undefined
  }

  const headline = !complete
    ? 'Enter an amount and a price for every asset, and the debt.'
    : hf === null
      ? 'With no debt there is no health factor.'
      : `Health factor ${hf.toFixed(3)}${hf < 1 ? ', liquidatable now' : ''}.`

  return (
    <div className="rounded-[5px] border border-rule bg-panel-2 p-5 shadow-lift">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Market"
          value={market}
          onChange={changeMarket}
          options={MARKETS.map((x) => ({ value: x.name, label: x.name }))}
        />
        <SelectField
          label="eMode"
          value={emode}
          onChange={changeEmode}
          options={[
            { value: '0', label: 'Off' },
            ...(m?.emodes ?? []).map((e) => ({
              value: String(e.id),
              label: e.label,
              note: share(e.threshold),
            })),
          ]}
        />
      </div>

      <div className="mt-6">
        <PanelLabel>Collateral</PanelLabel>
      </div>
      <div className="flex flex-col gap-4">
        {rows.map((r, i) => (
          <fieldset
            key={r.id}
            // Row 1 is there on load; only a row added since drops in.
            className={`grid grid-cols-2 items-end gap-3 border-b border-rule-soft pb-4 transition-opacity duration-150 sm:grid-cols-[1.4fr_1fr_1fr_auto] ${
              r.id > 1 ? 'animate-drop' : ''
            } ${leaving.has(r.id) ? 'opacity-0' : ''}`}
          >
            <legend className="sr-only">Collateral {i + 1}</legend>
            <div className="col-span-2 sm:col-span-1">
              <SelectField
                label={`Asset ${i + 1}`}
                value={r.reserve}
                onChange={(reserve) => edit(r.id, { reserve })}
                options={options.map((o) => ({
                  value: o.asset,
                  label: o.asset,
                  note: `${o.existingOnly ? 'existing only · ' : ''}${share(thresholdOf(o.asset))}`,
                }))}
              />
            </div>
            <NumberField
              label="Amount"
              error={errorOn(r.amount)}
              value={r.amount}
              onChange={(amount) => edit(r.id, { amount })}
            />
            <NumberField
              label="Price (USD)"
              error={errorOn(r.price, true)}
              value={r.price}
              onChange={(price) => edit(r.id, { price })}
            />
            {rows.length > 1 ? (
              <button
                type="button"
                onClick={() => remove(r.id)}
                aria-label={`Remove collateral ${i + 1}`}
                className="btn col-span-2 min-h-11 cursor-pointer sm:col-span-1"
              >
                Remove
              </button>
            ) : (
              <span className="hidden sm:block" />
            )}
          </fieldset>
        ))}
      </div>
      <button ref={adder} type="button" onClick={add} className="btn mt-4 min-h-11 cursor-pointer">
        Add collateral
      </button>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <NumberField
          label="Total debt (USD)"
          error={errorOn(debt)}
          value={debt}
          onChange={setDebt}
          hint="Held fixed: right for a stablecoin borrow"
        />
      </div>

      <div className="mt-6 border-t border-rule pt-5">
        {/* One sentence, for the reason HyperliquidCalculator gives. */}
        <p aria-live="polite" className="sr-only">
          {headline}
        </p>
        {/* Keyed, as HyperliquidCalculator's are. */}
        {hf === null || d === null ? (
          <p key={headline} id={messageId} aria-hidden className="animate-fade text-dim">
            {headline}
          </p>
        ) : (
          <div className="animate-fade">
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Readout
                label="Health factor"
                value={hf.toFixed(3)}
                note={hf < 1 ? 'Below 1: liquidatable now' : 'Liquidatable below 1'}
              />
              <Readout
                label="Collateral can fall"
                value={pct(-dropToLiquidation(hf))}
                note="All of it together, debt held fixed"
              />
              <Readout
                label="Close factor"
                value={hf >= 1 ? '—' : hf <= CLOSE_FACTOR_HF_THRESHOLD ? '100%' : '50%'}
                note={
                  hf >= 1
                    ? 'Applies once liquidatable'
                    : `Also 100% where a reserve is worth under ${dollars(CLOSE_FACTOR_RESERVE_FLOOR)}`
                }
              />
            </dl>
            <div className="mt-6">
              <PanelLabel>Liquidation price, one asset moving</PanelLabel>
            </div>
            <ul className="flex flex-col gap-1 font-mono text-[0.85rem]">
              {rows.map((r, i) => {
                const price = collateralLiquidationPrice(collateral, i, d)
                const now = collateral[i]?.price ?? 0
                return (
                  <li key={r.id} className="flex animate-fade flex-wrap justify-between gap-x-4">
                    <span className="text-dim">{r.reserve}</span>
                    <span>
                      {!collateral[i]?.value
                        ? '—'
                        : price === null
                          ? 'none: the rest covers the debt'
                          : `${usd(price)} (${pct((price - now) / now)})`}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
