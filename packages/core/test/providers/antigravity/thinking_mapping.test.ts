
import { describe, expect, it } from 'bun:test'
import { AntigravityProvider } from '../../../src/providers/antigravity'
import type { UnifiedRequest } from '../../../src/types/unified'

describe('Antigravity Thinking Budget Mapping', () => {
  const baseRequest: UnifiedRequest = {
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    thinking: {
      enabled: true,
      // budget will be set by the mapping logic
    }
  }

  const model = 'gemini-2.0-flash-thinking'

  it('should map reasoning_effort="low" to 8192 tokens', () => {
    const request: UnifiedRequest = {
      ...baseRequest,
      thinking: {
        enabled: true,
        effort: 'low'
      }
    }

    const provider = new AntigravityProvider()
    const result = provider.transform(request, model) as any
    const thinkingConfig = result.request.generationConfig?.thinkingConfig || result.request.generation_config?.thinking_config
    
    expect(thinkingConfig).toBeDefined()
    expect(thinkingConfig?.thinkingBudget || thinkingConfig?.thinking_budget).toBe(8192)
  })

  it('should map reasoning_effort="medium" to 16384 tokens', () => {
    const request: UnifiedRequest = {
      ...baseRequest,
      thinking: {
        enabled: true,
        effort: 'medium'
      }
    }

    const provider = new AntigravityProvider()
    const result = provider.transform(request, model) as any
    const thinkingConfig = result.request.generationConfig?.thinkingConfig || result.request.generation_config?.thinking_config
    
    expect(thinkingConfig).toBeDefined()
    expect(thinkingConfig?.thinkingBudget || thinkingConfig?.thinking_budget).toBe(16384)
  })

  it('should map reasoning_effort="high" to 32768 tokens', () => {
    const request: UnifiedRequest = {
      ...baseRequest,
      thinking: {
        enabled: true,
        effort: 'high'
      }
    }

    const provider = new AntigravityProvider()
    const result = provider.transform(request, model) as any
    const thinkingConfig = result.request.generationConfig?.thinkingConfig || result.request.generation_config?.thinking_config
    
    expect(thinkingConfig).toBeDefined()
    expect(thinkingConfig?.thinkingBudget || thinkingConfig?.thinking_budget).toBe(32768)
  })

  it('should prioritize explicit budget over effort', () => {
    const request: UnifiedRequest = {
      ...baseRequest,
      thinking: {
        enabled: true,
        effort: 'low',
        budget: 20000 // Explicit budget
      }
    }

    const provider = new AntigravityProvider()
    const result = provider.transform(request, model) as any
    const thinkingConfig = result.request.generationConfig?.thinkingConfig || result.request.generation_config?.thinking_config
    
    expect(thinkingConfig).toBeDefined()
    expect(thinkingConfig?.thinkingBudget || thinkingConfig?.thinking_budget).toBe(20000)
  })

  it('should default to 8192 tokens when no budget or effort is provided', () => {
    const request: UnifiedRequest = {
      ...baseRequest,
      thinking: {
        enabled: true
      }
    }

    const provider = new AntigravityProvider()
    const result = provider.transform(request, model) as any
    const thinkingConfig = result.request.generationConfig?.thinkingConfig || result.request.generation_config?.thinking_config
    
    expect(thinkingConfig).toBeDefined()
    expect(thinkingConfig?.thinkingBudget || thinkingConfig?.thinking_budget).toBe(8192)
  })
})
