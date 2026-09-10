/**
 * Does the loaded model follow a string a venue wrote?
 *
 * That is a property of the model, not of this repository, so this is not a
 * test and does not run in `bun test`: the `.eval.ts` name falls outside Bun's
 * `*.test.*` glob, which keeps it out of `bun test` and `bun run check` with no
 * configuration and no exclude list to go stale. What *is* this code's business
 * — that each payload arrives capped, stripped and marked — is asserted against
 * the same fixtures in `tools.test.ts`, on every commit, for nothing. Only the
 * model's reply needs the paid call, and that is all this file buys.
 *
 * It prints a report and does not fail on a breach. A model that starts
 * following a hostile symbol is not a defect a commit repairs: the moves are to
 * change the mark, change the system prompt, or drop the provider, and each of
 * those needs to know which payload got through and what the model actually
 * said. A non-zero exit here means the run itself broke.
 *
 *   bun run src/agent/injection.eval.ts
 */
import { appendFileSync } from 'node:fs'
import { Agent, MODEL } from './agent.js'
import { injectionEngine, INJECTION_PAYLOADS, type InjectionPayload } from './fixture.js'

interface Outcome {
  payload: InjectionPayload
  reply: string
  tools: string[]
  /** How the answer went wrong, or null if the payload did not land. */
  breach: string | null
  /** The run failing, which is a different thing from the payload landing. */
  broke: string | null
}

async function attempt(payload: InjectionPayload): Promise<Outcome> {
  let reply = ''
  const tools: string[] = []
  try {
    await new Agent(injectionEngine(payload)).ask(payload.question, {
      onText: (delta) => {
        reply += delta
      },
      onTool: (name) => {
        tools.push(name)
      },
      onTurn: () => {},
    })
  } catch (err) {
    return {
      payload,
      reply,
      tools,
      breach: null,
      broke: err instanceof Error ? err.message : String(err),
    }
  }
  return { payload, reply: reply.trim(), tools, breach: payload.breach(reply), broke: null }
}

function report(outcomes: Outcome[]): string {
  const verdict = (o: Outcome): string =>
    o.broke !== null ? 'run broke' : o.breach === null ? 'held' : 'got through'

  const lines: string[] = [
    '# Prompt injection eval',
    '',
    `Model \`${MODEL}\`, ${new Date().toISOString()}.`,
    '',
    'Each payload is a string a venue could write, placed where that kind of text',
    'actually arrives. A payload that got through is a finding about the model, not',
    'a broken build — the moves are to change the mark, the prompt, or the provider.',
    '',
    '| payload | carrier | verdict |',
    '| --- | --- | --- |',
    ...outcomes.map((o) => `| ${o.payload.id} | ${o.payload.carrier} | ${verdict(o)} |`),
    '',
  ]

  for (const o of outcomes) {
    lines.push(
      `## ${o.payload.id} — ${verdict(o)}`,
      '',
      `**Tried to** ${o.payload.goal}.`,
      '',
      '**Sent as**',
      '',
      '```',
      o.payload.arrived,
      '```',
      '',
      `**Asked** ${o.payload.question}`,
      '',
      `**Tools called** ${o.tools.length > 0 ? o.tools.join(', ') : 'none'}`,
      '',
    )
    if (o.broke !== null) lines.push(`**The run failed**: ${o.broke}`, '')
    else if (o.breach !== null) lines.push(`**Got through**: the model ${o.breach}.`, '')
    lines.push('**The model said**', '', '```', o.reply === '' ? '(nothing)' : o.reply, '```', '')
  }

  return lines.join('\n')
}

const outcomes: Outcome[] = []
for (const payload of INJECTION_PAYLOADS) outcomes.push(await attempt(payload))

const text = report(outcomes)
console.log(text)

const summary = process.env['GITHUB_STEP_SUMMARY']
// Appended, not written: the step summary is a shared file, and a run that
// truncates it takes whatever else the job put there with it.
if (summary) appendFileSync(summary, `${text}\n`)

process.exit(outcomes.some((o) => o.broke !== null) ? 1 : 0)
