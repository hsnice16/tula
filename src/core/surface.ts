/**
 * Where the text being written will be read. A remedy is only a remedy if it
 * can be typed where it is printed, and `/kraken connect` pasted into a real
 * shell is a path that does not exist.
 *
 * Process-wide because a process is one surface: `src/index.ts` opens the shell
 * or runs one command, never both.
 *
 * Down here rather than beside the command registry, which is where it began,
 * because `src/prices/providers.ts` has a remedy of its own to spell and the
 * registry imports the price list — so reaching back for it was a cycle. This
 * module imports nothing, which is what lets every layer say the same sentence.
 */
export type Surface = 'shell' | 'cli'

let surface: Surface = 'shell'

export function useSurface(next: Surface): void {
  surface = next
}

/** For the few remedies spelled per surface rather than merely prefixed. */
export function isCli(): boolean {
  return surface === 'cli'
}

/** A command as the reader would type it, on the surface they are reading. */
export function typed(command: string): string {
  return surface === 'cli' ? `tula ${command}` : `/${command}`
}

/**
 * Connecting is the one command spelled differently rather than merely
 * prefixed: the one-shot CLI documents `tula connect <venue>`, and `tula` with
 * no command opens the shell where the menu is.
 */
export function connectCommand(venueId: string): string {
  return surface === 'cli' ? `tula connect ${venueId}` : `/${venueId} connect`
}
