import type { Metadata } from 'next'
import { Nav } from '@/components/Nav'
import { releases, repoFile, type State } from '@/lib/content'
import { markdown } from '@/lib/markdown'
import { REPO } from '@/lib/site'

export const metadata: Metadata = {
  title: 'tula — roadmap',
  description: 'Version themes and the task breakdown behind each one, with live statuses.',
}

const TONE: Record<State | 'in-progress', string> = {
  done: 'text-ok border-[#2f3a24]',
  'in-progress': 'text-accent border-accent-dim',
  planned: 'text-faint border-rule',
  deferred: 'text-faint border-rule',
}

function Tag({ state, children }: { state: State; children: string }) {
  return (
    <span
      className={`flex-none whitespace-nowrap rounded-[2px] border bg-panel px-2 py-0.5 font-mono text-[0.66rem] uppercase tracking-[0.1em] ${TONE[state]}`}
    >
      {children}
    </span>
  )
}

export default async function Page() {
  const roadmap = await repoFile('ROADMAP.md')
  const themes = roadmap.slice(roadmap.indexOf('| Version'), roadmap.indexOf('## What v1 is not'))
  const tail = roadmap.slice(roadmap.indexOf('## What v1 is not'))
  const all = await releases()

  return (
    <>
      <Nav current="/roadmap" />
      <main className="wrap py-16">
        <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium tracking-[-0.025em]">
          Roadmap
        </h1>
        <p className="mb-10 max-w-[44rem] text-[1.08rem] text-dim">
          Every number is computed by deterministic code, and every view works without the model.
          The agent narrates; it never calculates.
        </p>

        <div className="doc mb-14 max-w-none">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: rendered at build time from a file in this repository */}
          <div dangerouslySetInnerHTML={{ __html: markdown(themes) }} />
        </div>

        <p className="label mb-5">
          <span className="text-accent-dim">Task breakdown</span>
        </p>
        <p className="mb-8 max-w-[44rem] text-dim">
          Read from <a href={`${REPO}/tree/main/tasks`}>tasks/</a> at build time, so these are the
          repository&apos;s own statuses.
        </p>

        {all.map((release) => (
          <section key={release.version}>
            <h2 className="mt-10 mb-3 flex items-baseline justify-between gap-4 border-b border-rule pb-2 font-mono text-base font-bold">
              <span>{release.version}</span>
              <Tag state={release.state}>
                {release.state === 'in-progress'
                  ? `${release.done} of ${release.tasks.length}`
                  : release.state}
              </Tag>
            </h2>
            <ul className="mb-7">
              {release.tasks.map((task) => (
                <li
                  key={task.file}
                  className="flex items-baseline justify-between gap-4 border-b border-rule-soft py-2 text-[0.9rem] last:border-b-0"
                >
                  <a
                    className="text-ink no-underline hover:text-accent"
                    href={`${REPO}/blob/main/tasks/${release.version}/${task.file}`}
                  >
                    {task.title}
                  </a>
                  <Tag state={task.state}>{task.status}</Tag>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="doc mt-12">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: rendered at build time from a file in this repository */}
          <div dangerouslySetInnerHTML={{ __html: markdown(tail) }} />
        </div>
      </main>
    </>
  )
}
