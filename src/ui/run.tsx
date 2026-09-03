import { render } from 'ink'
import type { Session } from '../cli/session.js'
import type { Connector } from '../connectors/types.js'
import { App } from './app.js'
import { guardResize } from './resize.js'

export async function runApp(
  session: Session,
  connectors: Map<string, Connector>,
  initialApiKey: string | undefined,
  initialVenues: string[],
): Promise<void> {
  // Before `render`, so it runs ahead of the erase Ink does for itself.
  guardResize(process.stdout)
  const instance = render(
    <App
      session={session}
      connectors={connectors}
      initialApiKey={initialApiKey}
      initialVenues={initialVenues}
    />,
    // Ctrl-C is handled in the app: it clears the line before it exits.
    { exitOnCtrlC: false },
  )
  await instance.waitUntilExit()
}
