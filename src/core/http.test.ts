import { afterEach, describe, expect, test } from 'bun:test'
import { TulaError } from './errors.js'
import { REQUEST_TIMEOUT_MS, request } from './http.js'

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
