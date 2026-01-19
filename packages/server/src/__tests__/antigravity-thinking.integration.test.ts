import { describe, expect, it } from 'bun:test'
import { AntigravityProvider } from '@llmux/core'
import type { AntigravityWireRequest, ProviderName, UnifiedRequest } from '@llmux/core'
import type { PartialDeep } from 'type-fest'

// Mock environment
process.env.ANTIGRAVITY_API_KEY = 'test-key'

describe('Integration: Antigravity Thinking Requests', () => {
  // We'll mock the actual HTTP fetch but go through the full pipeline
  
  it('should transform thinking request correctly for Claude 3.7 Thinking', () => {
    const provider = new AntigravityProvider('antigravity')
    
    // Simulate request with thinking enabled
    const request: PartialDeep<UnifiedRequest> = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      thinking: { enabled: true, budget: 4000, includeThoughts: true }, // Client format (camelCase logic)
      stream: true
    }
    
    // Mock the policy - in real server this comes from upstream-request-builder
    // In this test, we rely on provider.transform() respecting request.thinking.enabled
    
    // @ts-ignore - Accessing protected method or simulating internal flow
    const transformed = provider.transform(request as UnifiedRequest, 'claude-3-7-sonnet-thinking' as ProviderName) as AntigravityWireRequest
    
    // Verify snake_case wire format
    expect(transformed.request).toBeDefined()
    expect(transformed.request.generation_config).toBeDefined()
    expect(transformed.request.generation_config?.thinking_config).toBeDefined()
    expect(transformed.request.generation_config?.thinking_config?.include_thoughts).toBe(true)
    expect(transformed.request.generation_config?.thinking_config?.thinking_budget).toBe(4000)
    
    // Verify NO camelCase leaks
    expect((transformed as unknown as Record<string, unknown>).generationConfig).toBeUndefined()
    expect((transformed.request as unknown as Record<string, unknown>).generationConfig).toBeUndefined()
    expect((transformed.request.generation_config as unknown as Record<string, unknown> | undefined)?.thinkingConfig).toBeUndefined()
  })
  
  it('should NOT include thinking config for non-thinking models', () => {
    const provider = new AntigravityProvider('antigravity')
    
    const request: PartialDeep<UnifiedRequest> = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      // Even if client sends thinking config
      thinking: { enabled: true, budget: 4000 },
      stream: false
    }
    
    // Policy would be disabled for non-thinking model
    // In this test, we rely on provider.transform() checking model capabilities
    
    // @ts-ignore
    const transformed = provider.transform(request as UnifiedRequest, 'gpt-4o' as ProviderName) as AntigravityWireRequest
    
    // generation_config might be present if other settings exist, but thinking_config must not be
    // If generation_config is undefined, that's also fine (safe access)
    expect(transformed.request.generation_config?.thinking_config).toBeUndefined()
  })

  it('should disable thinking when policy says disabled (e.g. Claude Fresh)', () => {
    const provider = new AntigravityProvider('antigravity')
    
    const request: PartialDeep<UnifiedRequest> = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      thinking: { enabled: false, budget: 4000 },
      stream: true
    }
    
    // Simulate Claude Fresh policy (disabled)
    // We simulate this by explicitly disabling thinking in the request (which is what pipeline does)
    
    // @ts-ignore
    const transformed = provider.transform(request as UnifiedRequest, 'claude-3-7-sonnet-thinking' as ProviderName) as AntigravityWireRequest
    
    // If thinking is disabled and no other config, generation_config should be undefined
    // because applyThinkingConfig returns early, and clean up logic removes empty generationConfig
    expect(transformed.request.generation_config).toBeUndefined()
  })
  
  it('should format Antigravity request correctly matching opencode-antigravity-auth', () => {
      const provider = new AntigravityProvider('antigravity')

      const request: PartialDeep<UnifiedRequest> = {
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
          thinking: { enabled: true, budget: 1024, includeThoughts: false },
          stream: true
      }

      // @ts-ignore
      const transformed = provider.transform(request as UnifiedRequest, 'claude-3-7-sonnet-thinking' as ProviderName) as AntigravityWireRequest

      // Check structure matches opencode-antigravity-auth requirements
      expect(transformed.request_type).toBe('agent')
      expect(transformed.user_agent).toBe('antigravity')
      expect(transformed.request).toBeDefined()
      expect(transformed.request.contents).toBeDefined()
      expect(transformed.request.generation_config).toBeDefined()
      
      // Check thinking config mapping
      const thinking = transformed.request.generation_config?.thinking_config
      expect(thinking).toBeDefined()
      expect(thinking?.thinking_budget).toBe(1024)
      expect(thinking?.include_thoughts).toBe(false)
  })
})