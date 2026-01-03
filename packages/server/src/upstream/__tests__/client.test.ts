import { describe, expect, it, mock } from 'bun:test'
import { callUpstream } from '../client'

describe('callUpstream', () => {
  it('should call fetch with correct arguments', async () => {
    const originalFetch = global.fetch
    const mockFetch = mock(() => Promise.resolve(new Response('ok')))
    global.fetch = mockFetch as unknown as typeof fetch

    await callUpstream({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: { model: 'gpt-4' }
    })

    expect(mockFetch).toHaveBeenCalled()
    const calls = mockFetch.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const firstCall = calls[0]
    expect(firstCall).toBeDefined()
    const [url, init] = firstCall as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init?.body as string)).toEqual({ model: 'gpt-4' })

    global.fetch = originalFetch
  })
})
