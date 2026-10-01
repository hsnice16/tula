import { ImageResponse } from 'next/og'
import { CARD } from '@/lib/card'
import { guideCard, NAME, NAV, OG_IMAGE, SITE } from '@/lib/site'

export const dynamic = 'force-static'
export const dynamicParams = false

const GUIDES = NAV.filter((n) => n.group === 'guide')

/** Named `<route>.png`, so the exported file carries the extension a card crawler needs. */
export function generateStaticParams() {
  return GUIDES.map((n) => ({ card: `${n.href.slice(1)}.png` }))
}

/**
 * The card a link to one guide unfurls as: the guide's name and the sentence
 * `llms.txt` summarises it by, so a shared link says which page it is.
 */
export async function GET(_: Request, { params }: { params: Promise<{ card: string }> }) {
  const { card } = await params
  const guide = GUIDES.find((n) => guideCard(n.href) === `/og/${card}`)
  if (!guide) return new Response('Not found', { status: 404 })
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '64px 72px',
        background: CARD.bg,
        color: CARD.ink,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', fontSize: 34, fontWeight: 600, color: CARD.accent }}>
          {NAME}
        </div>
        <div style={{ display: 'flex', fontSize: 21, color: CARD.dim, letterSpacing: '0.08em' }}>
          read-only · non-custodial
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
        <div style={{ display: 'flex', fontSize: 30, color: CARD.accent, letterSpacing: '0.04em' }}>
          {guide.label}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 54,
            fontWeight: 600,
            marginTop: 18,
            lineHeight: 1.18,
            letterSpacing: '-0.02em',
          }}
        >
          {guide.blurb}
        </div>
      </div>
      <div style={{ display: 'flex', fontSize: 22, color: CARD.faint }}>
        {`${SITE.replace('https://', '')}${guide.href}`}
      </div>
    </div>,
    { width: OG_IMAGE.width, height: OG_IMAGE.height },
  )
}
