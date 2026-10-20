import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

/**
 * The calculators' inputs and readouts. No `'use client'`: it runs inside
 * whichever calculator imports it.
 */

/**
 * 16px below `sm`: iOS zooms the page into any field set smaller, on every tap.
 * Focus turns the border gold rather than ringing the box: a ring outside the
 * field read as a second box around it.
 */
const BOX =
  'min-h-11 w-full rounded-[3px] border border-faint bg-panel px-3 py-2 font-mono text-base text-ink outline-none transition-colors focus:border-accent-dim sm:text-[0.85rem]'

const LABEL = 'font-mono text-[0.72rem] uppercase tracking-[0.1em] text-dim'

const HINT = 'text-[0.78rem] text-dim'

/**
 * Text rather than `type="number"`: a number field reports an empty value for
 * anything mid-edit ("1e", "0.") and wheels its value away under a scrolling
 * trackpad.
 *
 * The hint is outside the label and described by it, so a hint that changes
 * with every keystroke does not rename the field each time.
 */
export function NumberField({
  label,
  value,
  onChange,
  hint,
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string | undefined
  /** The id of the calculator's message, when that message is about this field. */
  error?: string | undefined
}) {
  const id = useId()
  const described = [hint ? `${id}-hint` : '', error ?? ''].filter(Boolean).join(' ')
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className={`${BOX} aria-invalid:border-notice/60`}
      />
      {hint ? (
        <span id={`${id}-hint`} className={HINT}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

interface Choice {
  value: string
  label: string
  /** A figure set right of the label: a threshold, a max leverage. */
  note?: string
}

/**
 * A select drawn by the site, since the browser's own arrow and menu cannot be
 * styled: WAI-ARIA's select-only combobox, with focus kept on the button and
 * `aria-activedescendant` naming the option under the keys.
 */
export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly Choice[]
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const current = options[selected]

  // The list's own scroll, not `scrollIntoView`, which on a phone moves the page.
  useEffect(() => {
    const box = list.current
    const row = box?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    if (!open || !box || !row) return
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight
  }, [open, active])

  // Safari never focuses a clicked button, so blur alone cannot close the list.
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  const show = (at = selected) => {
    setActive(at)
    setOpen(true)
  }
  const choose = (at: number) => {
    const o = options[at]
    if (o) onChange(o.value)
    setOpen(false)
  }
  const clamp = (at: number) => Math.min(options.length - 1, Math.max(0, at))

  const typing = () => typed.current.text !== '' && Date.now() - typed.current.at < 500

  /**
   * The label starting with what was typed in the last half second. One letter
   * pressed again and again steps through the labels it starts, as a native
   * select does.
   */
  const seek = (key: string) => {
    const text = (typing() ? typed.current.text : '') + key.toLowerCase()
    typed.current = { text, at: Date.now() }
    const repeated = [...text].every((c) => c === text[0])
    const query = repeated ? text.slice(0, 1) : text
    const from = (open ? active : selected) + (repeated ? 1 : 0)
    const order = options.map((_, i) => (from + i) % options.length)
    return order.find((i) => options[i]?.label.toLowerCase().startsWith(query))
  }
  const printable = (e: KeyboardEvent) =>
    e.key.length === 1 && !e.ctrlKey && !e.metaKey && (e.key !== ' ' || typing())

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }
    if (!open) {
      if (printable(e)) {
        const at = seek(e.key)
        if (at !== undefined) show(at)
      } else if (e.key in step || e.key === 'Enter' || e.key === ' ') show()
      else if (e.key === 'Home') show(0)
      else if (e.key === 'End') show(options.length - 1)
      else return
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowUp' && e.altKey) choose(active)
    else if (printable(e)) {
      const at = seek(e.key)
      if (at !== undefined) setActive(at)
    } else if (e.key in step) setActive((a) => clamp(a + (step[e.key] ?? 0)))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(options.length - 1)
    else if (e.key === 'Enter' || e.key === ' ') choose(active)
    else if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'Tab') {
      choose(active)
      return
    } else return
    e.preventDefault()
  }

  return (
    <div ref={wrap} className="relative flex min-w-0 flex-col gap-1.5">
      <span id={`${id}-label`} className={LABEL}>
        {label}
      </span>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={`${id}-label ${id}`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        id={id}
        onClick={(e) => {
          e.currentTarget.focus()
          if (open) setOpen(false)
          else show()
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        className={`${BOX} flex cursor-pointer items-center gap-3 text-left`}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label}</span>
        {current?.note ? <span className="shrink-0 text-dim">{current.note}</span> : null}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-dim transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {/* Pressing an option must not blur the button first, or the list would
          close under the pointer before the click lands. */}
      <div
        ref={list}
        id={`${id}-list`}
        role="listbox"
        aria-labelledby={`${id}-label`}
        onMouseDown={(e) => e.preventDefault()}
        data-open={open || undefined}
        className="reveal absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-[3px] border border-rule bg-panel py-1 font-mono text-base shadow-lift sm:text-[0.85rem]"
      >
        {options.map((o, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox button holds focus and takes every key.
          <div
            key={o.value}
            id={`${id}-${i}`}
            data-index={i}
            role="option"
            tabIndex={-1}
            aria-selected={i === selected}
            onClick={() => choose(i)}
            onMouseMove={() => setActive(i)}
            className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 transition-colors duration-100 sm:min-h-9 ${
              i === active ? 'bg-rule' : ''
            } ${i === selected ? 'text-accent' : 'text-ink'}`}
          >
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.note ? <span className="shrink-0 text-dim">{o.note}</span> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Two or more options that read better side by side than in a menu. */
export function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  /** Options that exist but cannot be chosen here. */
  disabled?: readonly T[] | undefined
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className={`mb-1.5 ${LABEL}`}>{label}</legend>
      <div className="flex gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            disabled={disabled?.includes(o.value)}
            onClick={() => onChange(o.value)}
            className={`min-h-11 flex-1 cursor-pointer rounded-[3px] border px-3 py-2 font-mono text-[0.8rem] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              o.value === value
                ? 'border-accent-dim bg-panel-2 text-accent focus-visible:border-accent'
                : 'border-faint bg-panel text-dim hover:text-ink focus-visible:border-dim focus-visible:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function Readout({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string | undefined
}) {
  return (
    <div className="min-w-0">
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-1 font-mono text-[1.35rem] leading-tight text-ink">{value}</dd>
      {note ? <dd className={`mt-1 ${HINT}`}>{note}</dd> : null}
    </div>
  )
}

/** A heading inside a calculator's panel, styled as the field labels are. */
export function PanelLabel({ children }: { children: ReactNode }) {
  return <p className={`mb-3 ${LABEL}`}>{children}</p>
}
