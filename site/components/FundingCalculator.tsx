'use client'

import { useId, useState } from 'react'
import { NumberField, Readout, Toggle } from '@/components/Field'
import { FUNDING, fundingPaid, OPENING, type Side } from '@/lib/calc'
import { parse, percent, usd } from '@/lib/format'

const START = OPENING.funding

const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

/** Paid or received, in words: a sign alone reads differently in different places. */
const said = (n: number) =>
  n === 0 ? usd(0) : `${usd(Math.abs(n))} ${n > 0 ? 'paid' : 'received'}`

/**
 * What Hyperliquid funding costs or pays one position, from the hourly rate the
 * trade screen shows. The direction is a toggle rather than a minus sign, which
 * a phone's decimal keypad does not have.
 */
export function FundingCalculator() {
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [sign, setSign] = useState<'positive' | 'negative'>('positive')
  const [notional, setNotional] = useState(String(START.notional))
  const [rate, setRate] = useState(String(Number((START.ratePerHour * 100).toPrecision(12))))
  const [days, setDays] = useState(String(START.days))

  const n = parse(notional)
  const r = parse(rate)
  const d = parse(days)

  let problem: string | null = null
  let fault: 'size' | 'rate' | 'days' | null = null
  if (n === null || n <= 0) [problem, fault] = ['Enter a position size above zero.', 'size']
  else if (r === null)
    [problem, fault] = [
      'Enter the rate without a sign, such as 0.0013; pick Negative above.',
      'rate',
    ]
  else if (r / 100 > FUNDING.capPerHour) {
    problem = `Hyperliquid caps funding at ${percent(FUNDING.capPerHour, 0)} an hour.`
    fault = 'rate'
  } else if (d === null || d <= 0) [problem, fault] = ['Enter how many days you hold it.', 'days']
  const messageId = useId()
  const errorOn = (field: typeof fault) => (fault === field ? messageId : undefined)

  const s: Side = side === 'long' ? 1 : -1
  const result =
    problem === null && n !== null && r !== null && d !== null
      ? (() => {
          const hourly = (sign === 'positive' ? 1 : -1) * (r / 100)
          return {
            hour: fundingPaid(s, n, hourly, 1),
            day: fundingPaid(s, n, hourly, 24),
            held: fundingPaid(s, n, hourly, 24 * d),
            apr: s * hourly * 24 * 365,
            days: d,
          }
        })()
      : null

  const headline = result
    ? `${said(result.held)} over ${daysText(result.days)}, ${said(result.day)} a day.`
    : problem

  return (
    <div className="rounded-[5px] border border-rule bg-panel-2 p-5 shadow-lift">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Toggle
          label="Your side"
          value={side}
          onChange={setSide}
          options={[
            { value: 'long', label: 'Long' },
            { value: 'short', label: 'Short' },
          ]}
        />
        <Toggle
          label="Rate is"
          value={sign}
          onChange={setSign}
          options={[
            { value: 'positive', label: 'Positive' },
            { value: 'negative', label: 'Negative' },
          ]}
        />
        <NumberField
          label="Funding rate per hour (%)"
          error={errorOn('rate')}
          value={rate}
          onChange={setRate}
          hint={`At rest ${percent(FUNDING.interestPerHour, 5)}, positive`}
        />
        <NumberField
          label="Position size (USDC)"
          error={errorOn('size')}
          value={notional}
          onChange={setNotional}
        />
        <NumberField label="Days held" error={errorOn('days')} value={days} onChange={setDays} />
      </div>

      <div className="mt-6 border-t border-rule pt-5">
        {/* One sentence, for the reason HyperliquidCalculator gives. */}
        <p aria-live="polite" className="sr-only">
          {headline}
        </p>
        {/* Keyed, as HyperliquidCalculator's are. */}
        {result === null ? (
          <p key={problem} id={messageId} aria-hidden className="animate-fade text-dim">
            {problem}
          </p>
        ) : (
          <dl className="grid animate-fade grid-cols-1 gap-5 sm:grid-cols-3">
            <Readout label="Per hour" value={said(result.hour)} />
            <Readout label="Per day" value={said(result.day)} />
            <Readout
              label={`Over ${daysText(result.days)}`}
              value={said(result.held)}
              note={`${percent(Math.abs(result.apr))} a year, ${result.apr > 0 ? 'paid' : result.apr < 0 ? 'received' : 'neither paid nor received'}`}
            />
          </dl>
        )}
      </div>
    </div>
  )
}
