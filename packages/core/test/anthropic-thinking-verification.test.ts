
import { describe, it, expect } from 'bun:test'
import { transformRequest, parseRequest } from '../src/formats/anthropic-messages/request'
import type { UnifiedRequest } from '../src/types/unified'
import type { AnthropicRequest } from '../src/formats/anthropic-messages/types'

describe('Anthropic Thinking Support', () => {
  it('should transform UnifiedRequest with thinking enabled to AnthropicRequest', () => {
    const request: UnifiedRequest = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      thinking: {
        enabled: true,
        budget: 2048
      },
      config: {
        maxTokens: 8192
      }
    }

    const transformed = transformRequest(request)
    expect(transformed.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 2048
    })
    // max_tokens should remain 8192 since 8192 > 2048
    expect(transformed.max_tokens).toBe(8192)
  })

  it('should adjust max_tokens if budget is too close to max_tokens', () => {
    const request: UnifiedRequest = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      thinking: {
        enabled: true,
        budget: 4000
      },
      config: {
        maxTokens: 4000 // Too low
      }
    }

    const transformed = transformRequest(request)
    expect(transformed.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 4000
    })
    // max_tokens should be increased
    expect(transformed.max_tokens).toBeGreaterThan(4000)
    expect(transformed.max_tokens).toBe(4000 + 4096)
  })

  it('should parse AnthropicRequest with thinking back to UnifiedRequest', () => {
    const anthropicRequest: AnthropicRequest = {
      model: 'claude-3-7-sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 8192,
      thinking: {
        type: 'enabled',
        budget_tokens: 2048
      }
    }

    const parsed = parseRequest(anthropicRequest)
    expect(parsed.thinking).toEqual({
      enabled: true,
      budget: 2048
    })
  })

  it('should handle disabled thinking', () => {
    const request: UnifiedRequest = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      thinking: {
        enabled: false
      }
    }

    const transformed = transformRequest(request)
    expect(transformed.thinking).toEqual({ type: 'disabled' })
  })
})
