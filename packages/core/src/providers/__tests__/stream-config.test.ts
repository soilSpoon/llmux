
import { describe, expect, it } from 'bun:test'
import { AntigravityProvider } from '../antigravity'
import { GeminiProvider } from '../gemini'

describe('Provider Stream Configuration', () => {
  it('should use sse-line-delimited parser for AntigravityProvider to prevent buffering', () => {
    const provider = new AntigravityProvider()
    expect(provider.config.defaultStreamParser).toBe('sse-line-delimited')
  })

  it('should use sse-line-delimited parser for GeminiProvider to prevent buffering', () => {
    const provider = new GeminiProvider()
    expect(provider.config.defaultStreamParser).toBe('sse-line-delimited')
  })
})
