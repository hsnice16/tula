import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The repository root, one level above the site. Read at build time only. */
const ROOT = join(process.cwd(), '..')

export const repoFile = (name: string): Promise<string> => readFile(join(ROOT, name), 'utf8')

export type State = 'done' | 'in-progress' | 'planned' | 'deferred'

export interface Task {
  file: string
  title: string
  status: string
  state: State
}

export interface Release {
  version: string
  tasks: Task[]
  done: number
  state: 'done' | 'in-progress' | 'planned'
}

function stateOf(status: string): State {
  if (status.startsWith('done')) return 'done'
  if (status.startsWith('deferred')) return 'deferred'
  if (status.startsWith('in_progress') || status.startsWith('in progress')) return 'in-progress'
  return 'planned'
}

/**
 * Statuses are read from the task files themselves rather than copied into the
 * page, so what the site claims shipped is what the repository says shipped.
 */
export async function releases(): Promise<Release[]> {
  const versions = (await readdir(join(ROOT, 'tasks'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const out: Release[] = []
  for (const version of versions) {
    const files = (await readdir(join(ROOT, 'tasks', version)))
      .filter((file) => file.endsWith('.md') && file !== 'README.md')
      .sort()

    const tasks: Task[] = []
    for (const file of files) {
      const body = await readFile(join(ROOT, 'tasks', version, file), 'utf8')
      const title = /^#\s+(.*)$/m.exec(body)?.[1] ?? file
      const status = /^\*\*Status\*\*:\s*(.*)$/m.exec(body)?.[1]?.trim() ?? 'planned'
      tasks.push({ file, title, status, state: stateOf(status) })
    }

    const done = tasks.filter((task) => task.state === 'done').length
    out.push({
      version,
      tasks,
      done,
      state: done === tasks.length ? 'done' : done > 0 ? 'in-progress' : 'planned',
    })
  }
  return out
}
