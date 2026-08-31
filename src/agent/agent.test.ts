import { describe, expect, test } from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'
import { TulaError } from '../core/errors.js'
import { Agent, explain } from './agent.js'
import { fixtureEngine } from './fixture.js'

type Block = Record<string, unknown>

function message(stop: string, content: Block[]): Anthropic.Message {
  return { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: stop, content } as unknown as Anthropic.Message
}

const text = (t: string) => message('end_turn', [{ type: 'text', text: t }])
const toolCall = (name: string, input: unknown) =>
  message('tool_use', [{ type: 'tool_use', id: 'tu_1', name, input }])

/** A null in `responses` is a request that fails, the way an overloaded API does. */
function stubClient(responses: (Anthropic.Message | null)[]) {
  const calls: Record<string, any>[] = []
  let index = 0
  const client = {
    messages: {
      stream(params: Record<string, any>) {
        // Snapshot: the agent reuses one history array, so a stored reference
        // would show later turns rather than what this call actually sent.
        calls.push({ ...params, messages: structuredClone(params['messages']) })
        const msg = responses[index++]
        if (!msg) throw new Error('stub ran out of responses')
        return {
          on(event: string, cb: (t: string) => void) {
            if (event === 'text') {
              for (const b of msg.content) if (b.type === 'text') cb(b.text)
            }
            return this
          },
          async finalMessage() {
            return msg
          },
        }
      },
    },
  }
  return { client: client as unknown as Anthropic, calls }
}

function collect() {
  const text: string[] = []
  const tools: string[] = []
  return {
    events: { onText: (d: string) => text.push(d), onTool: (n: string) => tools.push(n) },
    text,
    tools,
  }
}

describe('Agent', () => {
  test('streams a plain answer through onText', async () => {
    const { client } = stubClient([text('Your net ETH exposure is 8.5.')])
    const sink = collect()
    await new Agent(fixtureEngine, { client }).ask('what is my eth exposure', sink.events)
    expect(sink.text.join('')).toBe('Your net ETH exposure is 8.5.')
    expect(sink.tools).toEqual([])
  })

  test('runs the tool and feeds the result back', async () => {
    const { client, calls } = stubClient([
      toolCall('get_net_exposure', { asset: 'ETH' }),
      text('8.5 ETH, as of noon.'),
    ])
    const sink = collect()
    await new Agent(fixtureEngine, { client }).ask('eth?', sink.events)

    expect(sink.tools).toEqual(['get_net_exposure'])
    const second = calls[1]!
    const toolResultTurn = second['messages'].at(-1)
    expect(toolResultTurn.role).toBe('user')
    expect(toolResultTurn.content[0].type).toBe('tool_result')
    // The model must receive the computed number, not compute one.
    expect(toolResultTurn.content[0].content).toContain('"net_quantity":"8.5"')
  })

  test('returns every tool result in a single user message', async () => {
    const { client, calls } = stubClient([
      message('tool_use', [
        { type: 'tool_use', id: 'a', name: 'get_net_exposure', input: {} },
        { type: 'tool_use', id: 'b', name: 'what_breaks_first', input: {} },
      ]),
      text('done'),
    ])
    const sink = collect()
    await new Agent(fixtureEngine, { client }).ask('both', sink.events)

    const turns = calls[1]!['messages']
    const results = turns.at(-1)
    expect(results.role).toBe('user')
    expect(results.content).toHaveLength(2)
    expect(turns.filter((m: any) => m.role === 'user')).toHaveLength(2)
  })

  test('a failing tool comes back as is_error, not a crash', async () => {
    const brokenEngine = {
      ...fixtureEngine,
      exposures: () => {
        throw new Error('engine exploded')
      },
    }
    const { client, calls } = stubClient([toolCall('get_net_exposure', {}), text('sorry')])
    await new Agent(brokenEngine, { client }).ask('eth?', collect().events)
    const result = calls[1]!['messages'].at(-1).content[0]
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('engine exploded')
  })

  test('sends the tools and the model we intend', async () => {
    const { client, calls } = stubClient([text('hi')])
    await new Agent(fixtureEngine, { client }).ask('hi', collect().events)
    const params = calls[0]!
    expect(params['model']).toBe('claude-opus-5')
    expect(params['thinking']).toEqual({ type: 'adaptive' })
    expect(params['tools'].map((t: any) => t.name)).toContain('what_breaks_first')
    expect(params['system']).toContain('never do arithmetic')
  })

  test('a refusal surfaces as an actionable error and is not kept in history', async () => {
    const { client } = stubClient([message('refusal', []), text('second question')])
    const agent = new Agent(fixtureEngine, { client })
    await expect(agent.ask('...', collect().events)).rejects.toBeInstanceOf(TulaError)
    await agent.ask('another', collect().events)
  })

  test('gives up rather than looping forever on tools', async () => {
    const { client } = stubClient(Array.from({ length: 12 }, () => toolCall('get_net_exposure', {})))
    await expect(new Agent(fixtureEngine, { client }).ask('loop', collect().events)).rejects.toThrow(
      /tool rounds/,
    )
  })

  test('carries conversation history across turns', async () => {
    const { client, calls } = stubClient([text('first'), text('second')])
    const agent = new Agent(fixtureEngine, { client })
    await agent.ask('one', collect().events)
    await agent.ask('two', collect().events)
    expect(calls[1]!['messages']).toHaveLength(3)
    agent.reset()
  })

  test('a failed request leaves no half-turn behind to be answered later', async () => {
    // The stub has no response for the second ask, so that turn throws mid-flight.
    const { client, calls } = stubClient([text('first'), null, text('third')])
    const agent = new Agent(fixtureEngine, { client })

    await agent.ask('one', collect().events)
    await expect(agent.ask('two', collect().events)).rejects.toBeInstanceOf(TulaError)
    await agent.ask('three', collect().events)

    const sent = calls.at(-1)!['messages'].map((m: any) => m.content)
    expect(sent).toEqual(['one', [{ type: 'text', text: 'first' }], 'three'])
  })
})

describe('explain', () => {
  const apiError = (status: number) =>
    new Anthropic.APIError(status, { type: 'error' }, 'Overloaded', undefined)

  test('an overload says whose fault it is and what to do', () => {
    const message = explain(apiError(529))
    expect(message).toContain('overloaded')
    expect(message).not.toContain('{')
    expect(message).toContain('/')
  })

  test('a rejected key points at the command that replaces it', () => {
    expect(explain(apiError(401))).toContain('/login')
  })

  test('every explanation names a way forward', () => {
    for (const status of [400, 401, 429, 500, 529]) {
      expect(explain(apiError(status))).toContain('Type / for the commands')
    }
    expect(explain(new Error('something else'))).toContain('Type / for the commands')
  })
})
