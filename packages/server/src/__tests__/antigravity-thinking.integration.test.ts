import { describe, expect, it } from 'bun:test'
import { AntigravityProvider, isAntigravityProviderRequest } from '@llmux/core'
import type { UnifiedRequest } from '@llmux/core'

// Mock environment
process.env.ANTIGRAVITY_API_KEY = 'test-key'

function createTestRequest(overrides: Partial<UnifiedRequest> = {}): UnifiedRequest {
  return {
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    model: 'claude-3-7-sonnet-thinking',
    ...overrides
  } as UnifiedRequest
}

describe('Integration: Antigravity Thinking Requests', () => {
  // We'll mock the actual HTTP fetch but go through the full pipeline
  
  it('should transform thinking request correctly for Claude 3.7 Thinking', () => {
    const provider = new AntigravityProvider('antigravity')
    
    // Simulate request with thinking enabled
    const request = createTestRequest({
      thinking: { enabled: true, budget: 4000, includeThoughts: true }, // Client format (camelCase logic)
      stream: true
    })
    
    // Mock the policy - in real server this comes from upstream-request-builder
    // In this test, we rely on provider.transform() respecting request.thinking.enabled
    
    const transformed = provider.transform(
      request,
      'claude-3-7-sonnet-thinking'
    )

    if (!isAntigravityProviderRequest(transformed)) {
      throw new Error('Expected AntigravityProviderRequest')
    }
    
    const antigravityRequest = transformed
    const payload = antigravityRequest.request

    // Verify snake_case wire format
    expect(payload).toBeDefined()
    // generationConfig is the alias, but we also want to check the snake_case keys inside
    expect(payload.generationConfig).toBeDefined()
    
    // Use type narrowing to access thinking_config safely
    const genConfig = payload.generationConfig
    if (genConfig && 'thinking_config' in genConfig && genConfig.thinking_config) {
      expect(genConfig.thinking_config).toBeDefined()
      expect(genConfig.thinking_config.include_thoughts).toBe(true)
      expect(genConfig.thinking_config.thinking_budget).toBe(4000)
    } else {
      throw new Error('Expected thinking_config in generationConfig')
    }

    // Verify snake_case keys exist (strict check)
    // We strictly check the payload for generation_config
    expect(payload.generation_config).toBeDefined()
  })
  
  it('should NOT include thinking config for non-thinking models', () => {
    const provider = new AntigravityProvider('antigravity')
    
    const request = createTestRequest({
      // Even if client sends thinking config
      thinking: { enabled: true, budget: 4000 },
      stream: false
    })
    
    // Policy would be disabled for non-thinking model
    // In this test, we rely on provider.transform() checking model capabilities
    // Use a Claude model that doesn't support thinking (or where we want to test disabled state)
    // Note: We need a model that resolves to Antigravity transport
    const transformed = provider.transform(
      request,
      'claude-3-haiku'
    )

    if (!isAntigravityProviderRequest(transformed)) {
        // If it returns GeminiCliRequest for some reason (unlikely for AntigravityProvider), we skip
        // But AntigravityProvider should always wrap.
        throw new Error('Expected AntigravityProviderRequest')
    }

    const payload = transformed.request
    
    // generation_config might be present if other settings exist, but thinking_config must not be
    // If generation_config is undefined, that's also fine (safe access)
    const genConfig = payload.generationConfig
    if (genConfig && 'thinking_config' in genConfig) {
       expect(genConfig.thinking_config).toBeUndefined()
    }
  })

  it('should disable thinking when policy says disabled (e.g. Claude Fresh)', () => {
    const provider = new AntigravityProvider('antigravity')
    
    const request = createTestRequest({
      thinking: { enabled: false, budget: 4000 },
      stream: true
    })
    
    // Simulate Claude Fresh policy (disabled)
    // We simulate this by explicitly disabling thinking in the request (which is what pipeline does)
    
    const transformed = provider.transform(
      request,
      'claude-3-7-sonnet-thinking'
    )

    if (!isAntigravityProviderRequest(transformed)) {
        throw new Error('Expected AntigravityProviderRequest')
    }

    const payload = transformed.request
    
    // If thinking is disabled and no other config, generation_config should be undefined OR not contain thinking_config
    // because applyThinkingConfig returns early
    const genConfig = payload.generationConfig || payload.generation_config
    if (genConfig) {
      if ('thinking_config' in genConfig) {
        expect(genConfig.thinking_config).toBeUndefined()
      }
      if ('thinkingConfig' in genConfig) {
        expect(genConfig.thinkingConfig).toBeUndefined()
      }
    }
  })
  
  it('should format Antigravity request correctly matching opencode-antigravity-auth', () => {
      const provider = new AntigravityProvider('antigravity')

      const request = createTestRequest({
          thinking: { enabled: true, budget: 1024, includeThoughts: false },
          stream: true
      })

      const transformed = provider.transform(
        request,
        'claude-3-7-sonnet-thinking'
      )

      if (!isAntigravityProviderRequest(transformed)) {
        throw new Error('Expected AntigravityProviderRequest')
      }

      const antigravityRequest = transformed
      const payload = antigravityRequest.request

      // Check structure matches opencode-antigravity-auth requirements
      expect(antigravityRequest.userAgent).toBe('antigravity')
      expect(antigravityRequest.metadata?.requestType).toBe('generateContent')
      expect(payload).toBeDefined()
      expect(payload.contents).toBeDefined()
      expect(payload.generationConfig).toBeDefined()
      
      // Check thinking config mapping
      const genConfig = payload.generationConfig
      if (genConfig && 'thinking_config' in genConfig && genConfig.thinking_config) {
        const thinking = genConfig.thinking_config
        expect(thinking).toBeDefined()
        expect(thinking.thinking_budget).toBe(1024)
        expect(thinking.include_thoughts).toBe(false)
      } else {
        throw new Error('Expected thinking_config')
      }
  })
})
