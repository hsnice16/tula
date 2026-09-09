/**
 * Text somebody else wrote, on its way to a screen or to the model.
 *
 * One rule, in one place: an asset symbol, a venue's error text and an ABI
 * decode were each carrying their own copy, and three copies of a filter that
 * have to agree are three chances to widen two of them.
 */

/**
 * `Default_Ignorable_Code_Point` rather than `Cf` alone. The 256 variation
 * selectors are category `Mn` and encode a byte each, so a `Cf` rule leaves an
 * exact channel open; the Hangul fillers are `Lo` and render as nothing. `Zl`
 * and `Zp` are separators no control-character rule catches, and in a view
 * built out of lines a forged line break reads as a second message.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

/**
 * Composed before it is filtered, so two spellings of one symbol reach the
 * book as one asset rather than netting as two.
 *
 * `replacement` is a space where the result is prose and the words either side
 * must not run together, and empty where it is a symbol and they must.
 */
export function visible(text: string, replacement = ''): string {
  return text.normalize('NFC').replace(INVISIBLE, replacement)
}
