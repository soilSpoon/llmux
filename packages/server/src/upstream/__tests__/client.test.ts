import { describe, expect, it, mock } from 'bun:test'
import { callUpstream } from '../client'

describe('callUpstream', () => {
  it('should call fetch with correct arguments', async () => {
    const originalFetch = global.fetch
    const mockFetch = mock(() => Promise.resolve(new Response('ok')))
    global.fetch = mockFetch

    await callUpstream({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: { model: 'gpt-4' }
    })

    expect(mockFetch).toHaveBeenCalled()
    const args = mockFetch.mock.calls[0]
    expect(args[0]).toBe('https://api.openai.com/v1/chat/completions')
    expect(args[1].method).toBe('POST')
    expect(args[1].headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(args[1].body as string)).toEqual({ model: 'gpt-4' })

    global.fetch = originalFetch
  })
})
