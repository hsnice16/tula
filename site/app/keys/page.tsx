import type { Metadata } from 'next'
import { Code } from '@/components/Code'
import { breadcrumb, JsonLd } from '@/components/JsonLd'
import keys from '@/lib/keys.json'
import { guideCard, NAME, NAV, OG, OG_IMAGE, TWITTER } from '@/lib/site'

const TITLE = 'Keyboard shortcuts for tula’s shell'
const IMAGE = {
  ...OG_IMAGE,
  url: guideCard('/keys'),
  alt: `Keys — ${NAV.find((n) => n.href === '/keys')?.blurb ?? TITLE}`,
}
const SUMMARY =
  'Every key tula’s shell answers to, grouped by what it is for: commands, editing the line, history, lists and suggestions, more than one line, and vim mode.'

export const metadata: Metadata = {
  title: TITLE,
  description: SUMMARY,
  alternates: { canonical: '/keys' },
  openGraph: {
    ...OG,
    images: [IMAGE],
    type: 'website',
    url: '/keys',
    title: `${TITLE} · ${NAME}`,
    description: SUMMARY,
  },
  twitter: { ...TWITTER, images: [IMAGE], title: `${TITLE} · ${NAME}`, description: SUMMARY },
}

interface Row {
  keys: readonly string[]
  does: string
  note?: string
}

/**
 * `lib/keys.json` is written from the binary's own keymap by `bun run keys:docs`
 * and checked against it by `src/ui/keymap.test.ts`, so this page cannot list a
 * key the shell does not answer to. Rows stack rather than scroll sideways, for
 * the reason AGENTS.md gives about tables on this site.
 */
export default function Page() {
  return (
    <main className="wrap pt-16 pb-step-3">
      <JsonLd schema={breadcrumb('Keys', '/keys')} />
      <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium leading-[1.1] tracking-[-0.025em]">
        Keyboard shortcuts
      </h1>
      <p className="mb-8 max-w-[42rem] text-[1.08rem] text-dim">
        In the shell, <Code>?</Code> on an empty line shows these, and <Code>/keys</Code> prints
        them.
      </p>

      {keys.groups.map((group) => (
        <section key={group.title} className="mb-step">
          <h2 className="label mb-4">{group.title}</h2>
          <dl className="max-w-[52rem]">
            {(group.rows as readonly Row[]).map((row) => (
              <div
                key={`${group.title}:${row.keys.join(' ')}`}
                className="grid items-baseline gap-x-8 gap-y-1 border-b border-rule-soft py-3 last:border-b-0 sm:grid-cols-[12rem_1fr]"
              >
                <dt className="flex flex-wrap gap-1.5">
                  {row.keys.map((key) => (
                    <Code key={key}>{key}</Code>
                  ))}
                </dt>
                <dd className="text-[0.92rem] text-ink">
                  {row.does}
                  {row.note ? (
                    <span className="block text-[0.82rem] text-dim">{row.note}</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </main>
  )
}
