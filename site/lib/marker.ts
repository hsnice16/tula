import { useLayoutEffect, useRef, useState } from 'react'

interface Mark {
  left: number
  width: number
  top: number
  height: number
  /** A first placement and a reflow are not moves, and must not be animated. */
  slide: boolean
}

/**
 * One underline that travels between the items of a row, rather than a border
 * switched on here and off there: that is a cut, and the eye loses which item it
 * is now on. `left` and `width` animate rather than a transform, because a
 * stretched `scaleX` would space a dotted border differently at every stop.
 *
 * Shared by the header nav and the install page's channel tabs. What travels is
 * the same in both; the border drawn on it is not, so the caller draws it.
 */
export function useMarker<L extends HTMLElement, I extends HTMLElement>(at: number) {
  const list = useRef<L>(null)
  const items = useRef<(I | null)[]>([])
  const [mark, setMark] = useState<Mark | null>(null)
  const placed = useRef(false)

  useLayoutEffect(() => {
    const on = items.current[at] ?? null
    const row = list.current
    // Rects rather than `offsetTop`/`offsetHeight`, which round to whole pixels:
    // half a pixel of that puts the underline beside the rule it draws on rather
    // than in it. `clientLeft`/`clientTop` are the row's own borders, which is
    // what makes this the padding-box origin the offsets would have used.
    const place = (slide: boolean) => {
      if (!on || !row) return setMark(null)
      const box = on.getBoundingClientRect()
      const of = row.getBoundingClientRect()
      setMark({
        left: box.left - of.left - row.clientLeft,
        top: box.top - of.top - row.clientTop,
        width: box.width,
        height: box.height,
        slide,
      })
    }
    place(placed.current)
    placed.current = on !== null
    // The row wraps, and an item that moves to the next line has moved as far as
    // a route change moves it — the wrap is what changes the container's height.
    // Observing fires once on its own, and that first call is not a move.
    if (!on || !row) return
    let observed = false
    const watch = new ResizeObserver(() => {
      if (observed) place(false)
      observed = true
    })
    watch.observe(row)
    return () => watch.disconnect()
  }, [at])

  /** For each item's `ref`, in the order `at` indexes them. */
  const item = (i: number) => (el: I | null) => {
    items.current[i] = el
    return () => {
      items.current[i] = null
    }
  }

  /** What the caller spreads onto the travelling element. */
  const style = mark && { left: mark.left, width: mark.width, top: mark.top, height: mark.height }

  return { mark, list, items, item, style }
}
