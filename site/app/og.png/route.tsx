import { ImageResponse } from 'next/og'
import { NAME, OG_IMAGE, SITE } from '@/lib/site'

// Static export: the card is rendered once at build time, like every page.
export const dynamic = 'force-static'

/**
 * The card a link to this site unfurls as. It makes the front page's argument
 * in the only shape a preview has room for: the same asset on three venues,
 * and the one line none of them can print.
 *
 * The figures are the front page's, and `src/site-example.test.ts` recomputes
 * them from the same book — a hand-typed number here would be a wrong
 * liquidation distance published where nobody scrolls past it to a correction.
 */
const ROWS = [
  ['kraken', 'ETH spot', '+4.00'],
  ['hyperliquid', 'ETH perp', '-2.00'],
  ['aave', 'ETH collateral', '+4.64'],
] as const

// site/app/globals.css, restated because a PNG cannot read a stylesheet.
const BG = '#131211'
const PANEL = '#1b1a19'
const PANEL_2 = '#201e1b'
const RULE = '#312e2b'
const ACCENT = '#d4a72c'
const INK = '#eceae5'
const DIM = '#8d877e'
const FAINT = '#666159'

export function GET() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '64px 72px',
        background: BG,
        color: INK,
        // Satori resolves one family for the whole card, so the terminal
        // reading has to come from the layout and the palette, not the face.
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', fontSize: 34, fontWeight: 600, color: ACCENT }}>{NAME}</div>
        <div style={{ display: 'flex', fontSize: 21, color: DIM, letterSpacing: '0.08em' }}>
          read-only · non-custodial
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
        <div style={{ display: 'flex', fontSize: 44, color: DIM, letterSpacing: '-0.02em' }}>
          Every venue weighs only what it holds.
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 62,
            fontWeight: 600,
            marginTop: 10,
            letterSpacing: '-0.025em',
          }}
        >
          tula weighs what you hold.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${RULE}` }}>
        <div style={{ display: 'flex', background: PANEL }}>
          {ROWS.map(([venue, what, qty]) => (
            <div
              key={venue}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '20px 24px',
                fontSize: 22,
              }}
            >
              <div style={{ display: 'flex', color: FAINT, letterSpacing: '0.06em' }}>{venue}</div>
              <div style={{ display: 'flex', color: DIM }}>
                {what}
                <span style={{ color: INK, fontWeight: 600 }}>&nbsp;{qty}</span>
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 20,
            fontSize: 24,
            padding: '20px 24px',
            background: PANEL_2,
            borderTop: `1px solid ${RULE}`,
          }}
        >
          <div style={{ display: 'flex', color: ACCENT, fontWeight: 700 }}>{NAME}</div>
          <div style={{ display: 'flex', color: DIM }}>
            net ETH
            <span style={{ color: ACCENT, fontWeight: 600 }}>&nbsp;6.64</span>
            <span>,&nbsp;</span>
            <span style={{ color: ACCENT, fontWeight: 600 }}>-27.0%</span>
            <span>&nbsp;to liquidation</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', marginTop: 28, fontSize: 20, color: FAINT }}>
        {SITE.replace('https://', '')}
      </div>
    </div>,
    { width: OG_IMAGE.width, height: OG_IMAGE.height },
  )
}
