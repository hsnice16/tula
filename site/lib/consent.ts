/** The visitor's analytics choice, kept in their browser and nowhere else. */
export const CONSENT_KEY = 'tula:analytics-consent'

/**
 * Where analytics waits for a yes: the EEA, the UK and Switzerland, plus the
 * EU's overseas regions, which geolocate under codes of their own. Consent Mode
 * applies this by the visitor's IP on Google's side, so the pages stay static.
 */
// biome-ignore format: a code per cell reads as the list it is, not 38 lines.
export const CONSENT_REGIONS = [
  'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB',
  'GF', 'GP', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MF',
  'MQ', 'MT', 'NL', 'NO', 'PL', 'PT', 'RE', 'RO', 'SE', 'SI', 'SK', 'YT',
]

/** Zones inside those regions whose names do not start with `Europe/`. */
const ZONES = new Set([
  'America/Cayenne',
  'America/Guadeloupe',
  'America/Marigot',
  'America/Martinique',
  'Arctic/Longyearbyen',
  'Asia/Famagusta',
  'Asia/Nicosia',
  'Atlantic/Azores',
  'Atlantic/Canary',
  'Atlantic/Madeira',
  'Atlantic/Reykjavik',
  'Indian/Mayotte',
  'Indian/Reunion',
])

export type ConsentChoice = 'granted' | 'denied'

/** A private window or blocked storage throws; that reads as no choice yet. */
export function readConsent(): ConsentChoice | null {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY)
    return value === 'granted' || value === 'denied' ? value : null
  } catch {
    return null
  }
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

/**
 * Store the choice and tell GA at once. A withdrawal also deletes the cookies
 * GA already set: denying storage stops new ones, it does not remove old ones.
 */
export function chooseConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice)
  } catch {
    // Unstored, the choice still holds for this page; the banner asks again later.
  }
  window.gtag?.('consent', 'update', { analytics_storage: choice })
  if (choice === 'denied') {
    const host = window.location.hostname
    for (const name of document.cookie.split(';').map((c) => c.split('=')[0]?.trim() ?? '')) {
      if (name !== '_ga' && !name.startsWith('_ga_')) continue
      for (const domain of ['', `; domain=${host}`, `; domain=.${host}`]) {
        // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing from Safari, and this only deletes.
        document.cookie = `${name}=; Max-Age=0; path=/${domain}`
      }
    }
  }
  window.dispatchEvent(new Event(CONSENT_KEY))
}

/**
 * The banner cannot see the IP region Google applies, so it goes by time zone.
 * A miss costs one dismissible card, or none for someone already opted out.
 */
export function inConsentRegion(): boolean {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    return zone.startsWith('Europe/') || ZONES.has(zone)
  } catch {
    return false
  }
}
