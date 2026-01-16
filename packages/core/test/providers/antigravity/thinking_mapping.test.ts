
import { describe, expect, it } from 'bun:test'
import { transform } from '../../../src/providers/antigravity/request'
import type { UnifiedRequest } from '../../../src/types/unified'
import type { ClaudeThinkingConfig } from '../../../src/providers/antigravity/types'

describe('Antigravity Thinking Budget Mapping', () => {
  const baseRequest: UnifiedRequest = {
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    thinking: {
      enabled: true,
      // budget will be set by the mapping logic
    }
  }

  const model = 'claude-sonnet-4-5-thinking'

  it('should map reasoning_effort="low" to 8192 tokens', () => {
    const request: UnifiedRequest = {
      ...baseRequest,
      thinking: {
        enabled: true,
        effort: 'low'
      }
    }

    const result = transform(request, model)
    const thinkingConfig = result.request.generationConfig?.thinkingConfig as ClaudeThinkingConfig
    
    expect(thinkingConfig).toBeDefined()
    expect(thinkingConfig.thinkingBudget).toBe(8192)
  })

  it('should map reasoning_effort="medium" to 16384 tokens', () => {
    const request: UnifiedRequest = {
      ...baseRequest,
      thinking: {
        enabled: true,
        effort: 'medium'
      }
    }

    const result = transform(request, model)
    const thinkingConfig = result.request.generationConfig?.thinkingConfig as ClaudeThinkingConfig
    
    expect(thinkingConfig).toBeDefined()
    expect(thinkingConfig.thinkingBudget).toBe(16384)
  })

  it('should map reasoning_effort="high" to 32768 tokens', () => {
    const request: UnifiedRequest = {
      ...baseRequest,
      thinking: {
        enabled: true,
        effort: 'high'
      }
    }

    const result = transform(request, model)
    const thinkingConfig = result.request.generationConfig?.thinkingConfig as ClaudeThinkingConfig
    
    expect(thinkingConfig).toBeDefined()
    expect(thinkingConfig.thinkingBudget).toBe(32768)
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

    const result = transform(request, model)
    const thinkingConfig = result.request.generationConfig?.thinkingConfig as ClaudeThinkingConfig
    
    expect(thinkingConfig).toBeDefined()
    expect(thinkingConfig.thinkingBudget).toBe(20000)
  })

  it('should default to 16000 tokens when no budget or effort is provided', () => {
    const request: UnifiedRequest = {
      ...baseRequest,
      thinking: {
        enabled: true
      }
    }

    const result = transform(request, model)
    const thinkingConfig = result.request.generationConfig?.thinkingConfig as ClaudeThinkingConfig
    
    expect(thinkingConfig).toBeDefined()
    expect(thinkingConfig.thinkingBudget).toBe(16000)
  })
})
