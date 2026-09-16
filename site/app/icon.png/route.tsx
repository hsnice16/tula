import { ImageResponse } from 'next/og'
import { ICON } from '@/lib/site'

// Static export: rendered once at build time, as `app/og.png` is.
export const dynamic = 'force-static'

/**
 * The favicon a search result shows beside the site name. Google lists the
 * formats it accepts, and SVG is not one of them, so `app/icon.svg` alone can
 * leave the result with a generic globe. A multiple of 48px, as it asks.
 *
 * A route with the extension in its name, for the reason `apple-icon.png` is
 * one. On the page's own ground, because a result page is white and the gold
 * mark alone is faint on it.
 */
export function GET() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#131211',
      }}
    >
      <svg width="76" height="76" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <g stroke="#d4a72c" strokeWidth="2.6" strokeLinecap="round">
          <path d="M6 15h5a5 5 0 0 1 10 0h5" />
          <path d="M6 22h20" />
        </g>
      </svg>
    </div>,
    { width: ICON.size, height: ICON.size },
  )
}
