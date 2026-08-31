/**
 * A markdown library would be one more dependency; this covers only the subset
 * CHANGELOG.md and ROADMAP.md actually use. It runs at build time inside a
 * server component, so none of it reaches the browser.
 */
import { REPO } from './site'

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Inline code is lifted out first so nothing inside it is treated as markup.
 * The sentinel has to be something prose cannot contain: an earlier version
 * used a bare number between spaces, which silently ate "top 500 by".
 */
function inline(text: string): string {
  const code: string[] = []
  let out = text.replace(/`([^`]+)`/g, (_, body: string) => {
    code.push(`<code>${escapeHtml(body)}</code>`)
    return `CODE${code.length - 1}`
  })
  out = escapeHtml(out)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
    const local = href.startsWith('./') || href.startsWith('../')
    const url = local
      ? `${REPO}/blob/main/${href.replace(/^\.\//, '').replace(/^\.\.\//, '')}`
      : href
    return `<a href="${url}">${label}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  return out.replace(/CODE(\d+)/g, (_, i: string) => code[Number(i)] ?? '')
}

export function markdown(src: string): string {
  const out: string[] = []
  let inList = false
  let table: string[][] | null = null
  let fence = false

  const closeList = () => {
    if (inList) out.push('</ul>')
    inList = false
  }
  const closeTable = () => {
    if (!table) return
    const [head, ...body] = table
    out.push('<div class="scroll"><table>')
    if (head) {
      out.push(`<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`)
    }
    out.push('<tbody>')
    for (const row of body) {
      out.push(`<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
    }
    out.push('</tbody></table></div>')
    table = null
  }

  for (const raw of src.split('\n')) {
    const line = raw.trimEnd()

    if (line.startsWith('```')) {
      closeList()
      closeTable()
      out.push(fence ? '</code></pre>' : '<pre><code>')
      fence = !fence
      continue
    }
    if (fence) {
      out.push(escapeHtml(raw))
      continue
    }

    if (line.startsWith('|')) {
      closeList()
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
      // The --- separator row carries no content.
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue
      table ??= []
      table.push(cells)
      continue
    }
    closeTable()

    if (line === '') {
      closeList()
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading?.[1] && heading[2] !== undefined) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    const item = /^[-*]\s+(.*)$/.exec(line)
    if (item?.[1] !== undefined) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(item[1])}</li>`)
      continue
    }

    if (/^-{3,}$/.test(line)) {
      closeList()
      continue
    }

    // These files are hard-wrapped at 80 columns, so a bare line continues what
    // came before it rather than starting a new block. Inside a list that means
    // the open <li>: pushed as its own <p> it would land between list items,
    // which is invalid HTML and reads as a stray paragraph mid-bullet.
    const previous = out[out.length - 1]
    if (inList && previous?.endsWith('</li>')) {
      out[out.length - 1] = `${previous.slice(0, -5)} ${inline(line.trim())}</li>`
      continue
    }
    if (!inList && previous?.startsWith('<p>') && previous.endsWith('</p>')) {
      out[out.length - 1] = `${previous.slice(0, -4)} ${inline(line)}</p>`
      continue
    }
    out.push(`<p>${inline(line)}</p>`)
  }

  closeList()
  closeTable()
  return out.join('\n')
}
