/**
 * A small reference table: a few rows, two or three short columns, narrow
 * enough for a phone without scrolling or stacking. Anything wider stacks, as
 * the install page's does, whose rules and type this follows.
 */
export function Table({
  head,
  rows,
  caption,
}: {
  head?: readonly string[]
  rows: readonly (readonly string[])[]
  caption?: string
}) {
  return (
    <table
      className={`mb-4 w-full border-collapse text-[0.89rem] tabular-nums ${head ? '' : 'border-t border-rule'}`}
    >
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      {head ? (
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-rule pb-2 pr-4 text-left font-mono text-[0.72rem] font-normal uppercase tracking-[0.1em] text-dim"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((r) => (
          <tr key={r.join('|')} className="border-b border-rule">
            {r.map((cell, i) =>
              i === 0 ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: a row's cells never reorder.
                <th key={i} scope="row" className="py-2.5 pr-4 text-left font-normal text-ink">
                  {cell}
                </th>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: a row's cells never reorder.
                <td key={i} className="py-2.5 pr-4 text-dim">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
