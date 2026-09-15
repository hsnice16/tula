import { render } from 'ink'
import type { Session } from '../cli/session.js'
import type { Connector } from '../connectors/types.js'
import { App } from './app.js'
import { guardResize } from './resize.js'
import { holdInputModes } from './terminal.js'

export async function runApp(
  session: Session,
  connectors: Map<string, Connector>,
  initialApiKey: string | undefined,
  initialVenues: string[],
): Promise<void> {
  // Before `render`, so it runs ahead of the erase Ink does for itself.
  guardResize(process.stdout)
  // Before `render` too: it watches the writes that set each mode, and the app
  // pushes the keyboard protocol from its first render on.
  const release = holdInputModes(process.stdout)
  // Raw before anything is asked of the terminal. A tty still in canonical mode
  // holds an answer until a newline and echoes it onto the screen. Ink takes
  // raw mode over from here and turns it off on exit.
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  let instance: ReturnType<typeof render>
  try {
    instance = render(
      <App
        session={session}
        connectors={connectors}
        initialApiKey={initialApiKey}
        initialVenues={initialVenues}
        keyboardProtocol
      />,
      {
        // Ctrl-C is handled in the app: it clears the line before it exits.
        exitOnCtrlC: false,
        // No `kittyKeyboard`: the app asks and pushes the protocol itself, and
        // the `keyboardProtocol` prop on `App` says why Ink's detection is not used.
      },
    )
  } catch (err) {
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    release()
    throw err
  }
  try {
    await instance.waitUntilExit()
  } finally {
    release()
  }
}
