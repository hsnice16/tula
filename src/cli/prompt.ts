const ETX = '\u0003'
const DEL = '\u007f'
const BACKSPACE = '\u0008'

import type { ConnectorCredentials, CredentialField } from '../connectors/types.js'
import { TulaError } from '../core/errors.js'

let piped: string[] | null = null

async function nextPipedLine(command: string): Promise<string> {
  if (piped === null) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    // No TTY and no piped input means nobody can answer the prompt. Saying so
    // beats failing later on an empty value, which reads as a validation bug.
    if (raw.trim() === '') {
      throw new TulaError(
        `${command} needs an interactive terminal.\n` +
          'Run it directly in your shell, or pipe the values in:\n' +
          `  printf 'KEY\\nSECRET\\n' | ${command}`,
      )
    }
    piped = raw.split('\n')
  }
  return (piped.shift() ?? '').trim()
}

function fromTty(label: string, hidden: boolean): Promise<string> {
  const { stdin, stdout } = process
  stdout.write(label)

  return new Promise<string>((resolve) => {
    let buf = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    const restore = (): void => {
      stdin.removeListener('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
    }

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          restore()
          resolve(buf.trim())
          return
        }
        if (ch === ETX) {
          restore()
          process.exit(130)
        }
        if (ch === DEL || ch === BACKSPACE) {
          buf = buf.slice(0, -1)
          if (!hidden) stdout.write('\b \b')
          continue
        }
        if (ch < ' ') continue
        buf += ch
        if (!hidden) stdout.write(ch)
      }
    }

    stdin.on('data', onData)
  })
}

/**
 * Raw mode rather than a readline prompt because a secret must never be
 * echoed — terminals get screenshotted and scrollback outlives the session.
 */
export async function ask(
  label: string,
  opts: { hidden: boolean; command: string },
): Promise<string> {
  if (!process.stdin.isTTY) return nextPipedLine(opts.command)
  return fromTty(label, opts.hidden)
}

/**
 * One prompt per field the connectable declares, which is the same list the
 * in-app flow walks. A hardcoded key/secret pair here asked the three
 * address-only venues for an API key they do not have — so none of them could
 * be connected from the command line at all — and typed a single-field
 * restricted key in the clear because the pair's first prompt was not secret.
 */
export async function askFields(
  fields: readonly CredentialField[],
  opts: {
    command: string
    log?: (line: string) => void
    /** Overridden only by the tests: `ask` reads the real stdin once per
     *  process, which no test can hand a second answer to. */
    prompt?: typeof ask
  },
): Promise<ConnectorCredentials> {
  const write = opts.log ?? ((line: string) => console.log(line))
  const prompt = opts.prompt ?? ask
  const width = Math.max(...fields.map((f) => f.label.length))
  const creds: Record<string, string> = {}
  for (const field of fields) {
    if (field.hint) write(`  (${field.hint})`)
    const value = await prompt(`  ${field.label.padEnd(width)}: `, {
      hidden: field.secret,
      command: opts.command,
    })
    if (!value) throw new TulaError(`${field.label} is required.`)
    creds[field.name] = value
  }
  return creds
}
