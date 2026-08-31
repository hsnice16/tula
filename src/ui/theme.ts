/**
 * Gold, deliberately dulled. It is the unit everything here is ultimately
 * measured against, and it reads as an instrument rather than a dashboard —
 * a saturated yellow in a terminal looks like a warning, which is a meaning
 * this palette needs to keep in reserve.
 *
 * Hex degrades to the nearest ANSI colour on terminals without truecolor.
 */
export const theme = {
  /** Prompt, borders, the selected row. */
  accent: '#c9a227',
  /** Same hue, backed off: inactive chrome and secondary marks. */
  accentSoft: '#8a7220',
  /** Advisory lines — lighter, so it separates from the accent. */
  notice: '#dcbc64',
  /** Semantic, never decorative. Errors stay red on purpose. */
  danger: 'red',
  /** Disabled chrome while a request is in flight. */
  muted: 'gray',
  /**
   * A warm panel behind the input so the line you type on is a surface rather
   * than a gap. Tinted toward the accent rather than neutral grey, and kept
   * dark enough that the terminal's own text colour still reads on it.
   */
  surface: '#2a2418',
} as const
