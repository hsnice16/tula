import { render } from 'ink'
import type { Session } from '../cli/session.js'
import type { Connector } from '../connectors/types.js'
import { App, bannerText } from './app.js'

export async function runApp(
  session: Session,
  connectors: Map<string, Connector>,
  initialApiKey: string | undefined,
  initialVenues: string[],
): Promise<void> {
  console.log(`${bannerText()}\n`)
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
