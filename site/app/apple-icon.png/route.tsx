import { ImageResponse } from 'next/og'
import { APPLE_ICON } from '@/lib/site'

// Static export: rendered once at build time, as `app/og.png` is.
export const dynamic = 'force-static'

/**
 * The home-screen icon. iOS ignores an SVG favicon, and with no
 * `apple-touch-icon` it bookmarks a screenshot of the page — a grey rectangle
 * at that size.
 *
 * A route with the extension in its name, not `app/apple-icon.tsx`: Next's
 * metadata-file convention exports the image with no extension at all, and a
 * static host serves that as a byte stream. `og.png` is a route for the same
 * reason, and `site/lib/site.ts` says so where the card is declared.
 *
 * Drawn rather than converted, because the mark is two strokes — `app/icon.svg`
 * and `components/Logo.tsx` state the same geometry. No rounded plate: iOS
 * masks the icon itself, and one that rounds its own corners is clipped twice.
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
      <svg width="132" height="132" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <g stroke="#d4a72c" strokeWidth="2.4" strokeLinecap="round">
          <path d="M6 15h5a5 5 0 0 1 10 0h5" />
          <path d="M6 22h20" />
        </g>
      </svg>
    </div>,
    { width: APPLE_ICON.size, height: APPLE_ICON.size },
  )
}
