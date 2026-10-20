/**
 * Tells the IndexNow engines (Bing, Yandex and the rest) that every URL in the
 * live sitemap has changed. Run by hand once a deploy is live: the sitemap is
 * read from the site rather than from `out/`, so it names what is published,
 * not what was last built here.
 */
import { readdirSync } from 'node:fs'
import { SITE } from '../lib/site'

// The key is the name of the file that proves it, which `public/` serves.
const file = readdirSync(new URL('../public/', import.meta.url)).find((f) =>
  /^[0-9a-f]{32}\.txt$/.test(f),
)
if (!file) throw new Error('public/ holds no IndexNow key file')
const key = file.slice(0, -'.txt'.length)

const sitemap = await fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(30_000) })
if (!sitemap.ok) throw new Error(`${SITE}/sitemap.xml answered ${sitemap.status}`)
const urlList = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
if (urlList.length === 0) throw new Error('the live sitemap names no URL')

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: new URL(SITE).host,
    key,
    keyLocation: `${SITE}/${file}`,
    urlList,
  }),
  signal: AbortSignal.timeout(30_000),
})
// 200 and 202 both mean received; anything else is the engine refusing the batch.
if (res.status !== 200 && res.status !== 202) {
  throw new Error(`IndexNow answered ${res.status}: ${await res.text()}`)
}
console.log(`IndexNow: ${urlList.length} URLs sent, answered ${res.status}`)
