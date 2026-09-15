import { afterEach, describe, expect, test } from 'bun:test'
import { TulaError } from './errors.js'
import { MAX_BODY_BYTES, REQUEST_TIMEOUT_MS, request } from './http.js'

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
})

describe('request', () => {
  test('carries a timeout on every call', async () => {
    let seen: AbortSignal | undefined
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen = init.signal as AbortSignal
      return new Response('ok')
    }) as typeof fetch

    await request('https://example.invalid/x')
    expect(seen).toBeInstanceOf(AbortSignal)
    expect(seen?.aborted).toBe(false)
  })

  test('a venue that never answers is named, not left hanging', async () => {
    // What a half-open connection looks like from here: the promise rejects the
    // way an aborted fetch does, rather than resolving late.
    globalThis.fetch = (async () => {
      const err = new Error('The operation was aborted')
      err.name = 'TimeoutError'
      throw err
    }) as unknown as typeof fetch

    const failure = request('https://api.kraken.com/0/private/Balance')
    await expect(failure).rejects.toBeInstanceOf(TulaError)
    // The host, and a next step — an abort's own message carries neither.
    await expect(failure).rejects.toThrow(/api\.kraken\.com/)
    await expect(failure).rejects.toThrow(/refresh/)
  })

  test('a real network error keeps its own message', async () => {
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as unknown as typeof fetch
    await expect(request('https://nope.invalid')).rejects.toThrow(/ENOTFOUND/)
  })

  test('preserves the caller’s method, headers and body', async () => {
    let init: RequestInit | undefined
    globalThis.fetch = (async (_url: string, got: RequestInit) => {
      init = got
      return new Response('ok')
    }) as typeof fetch

    await request('https://example.invalid/x', {
      method: 'POST',
      headers: { 'X-Test': '1' },
      body: 'payload',
    })
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('payload')
    expect((init?.headers as Record<string, string>)['X-Test']).toBe('1')
  })

  test('the ceiling is low enough to fail before a user gives up on it', () => {
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
  })
})

// Over a real socket: a stubbed `fetch` hands back a whole body at once, so it
// never streams and cannot show a read stopping part-way.
describe('the size of an answer', () => {
  const MB = new Uint8Array(1_000_000).fill(0x20)
  let server: ReturnType<typeof Bun.serve> | undefined
  afterEach(() => {
    server?.stop(true)
    server = undefined
  })

  /** Serves `bytes` of JSON-safe filler in 1 MB chunks, with no Content-Length. */
  const serving = (bytes: number): string => {
    server = Bun.serve({
      port: 0,
      fetch() {
        let sent = 0
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (sent >= bytes) return controller.close()
              controller.enqueue(sent === 0 ? new TextEncoder().encode('{"ok":true}') : MB)
              sent += sent === 0 ? 11 : MB.length
            },
          }),
        )
      },
    })
    return `http://127.0.0.1:${server.port}/`
  }

  test('an answer inside the cap reads as it always did', async () => {
    const res = await request(serving(3_000_000))
    expect(await res.json()).toEqual({ ok: true })
  })

  test('an answer streaming past the cap is refused by host, whichever way it is read', async () => {
    const url = serving(MAX_BODY_BYTES + 2_000_000)
    for (const read of ['json', 'text', 'arrayBuffer'] as const) {
      const failure = (await request(url))[read]()
      await expect(failure).rejects.toBeInstanceOf(TulaError)
      await expect(failure).rejects.toThrow(/127\.0\.0\.1:\d+ sent more than 16 MB/)
    }
  })

  test('a caller streaming the body itself is not capped, so the update download still arrives whole', async () => {
    const total = MAX_BODY_BYTES + 2_000_000
    const reader = (await request(serving(total))).body!.getReader()
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
    }
    expect(received).toBeGreaterThan(MAX_BODY_BYTES)
  })
})
