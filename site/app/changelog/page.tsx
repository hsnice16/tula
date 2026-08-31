import type { Metadata } from 'next'
import Link from 'next/link'
import { Nav } from '@/components/Nav'
import { repoFile } from '@/lib/content'
import { markdown } from '@/lib/markdown'
import { REPO } from '@/lib/site'

export const metadata: Metadata = {
  title: 'tula — changelog',
  description: 'What has shipped in tula, by version.',
}

export default async function Page() {
  const source = await repoFile('CHANGELOG.md')
  // The file's own title and preamble are replaced by this page's.
  const body = source.slice(source.indexOf('## '))

  return (
    <>
      <Nav current="/changelog" />
      <main className="wrap py-16">
        <h1 className="mb-5 text-[clamp(2rem,4.5vw,2.8rem)] font-medium tracking-[-0.025em]">
          Changelog
        </h1>
        <p className="mb-6 max-w-[44rem] text-[1.08rem] text-dim">
          Generated from <a href={`${REPO}/blob/main/CHANGELOG.md`}>CHANGELOG.md</a> at build time,
          so it cannot drift.
        </p>

        <div className="mb-12 max-w-[46rem] rounded-r border border-l-2 border-rule border-l-accent-dim bg-panel px-5 py-4">
          <p>
            Every version below is <strong className="font-semibold text-white">unreleased</strong>.
            See <Link href="/install">Install</Link>.
          </p>
        </div>

        <div className="doc">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: rendered at build time from a file in this repository */}
          <div dangerouslySetInnerHTML={{ __html: markdown(body) }} />
        </div>
      </main>
    </>
  )
}
