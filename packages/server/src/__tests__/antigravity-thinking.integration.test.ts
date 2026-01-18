import { describe, expect, it } from 'bun:test'
import { AntigravityProvider } from '@llmux/core'
import type { ProviderName } from '@llmux/core'

// Mock environment
process.env.ANTIGRAVITY_API_KEY = 'test-key'

describe('Integration: Antigravity Thinking Requests', () => {
  // We'll mock the actual HTTP fetch but go through the full pipeline
  
  it('should transform thinking request correctly for Claude 3.7 Thinking', () => {
    const provider = new AntigravityProvider({
      apiKey: 'test-key',
      model: 'claude-3-7-sonnet-thinking',
    } as any)
    
    // Simulate request with thinking enabled
    const request = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      thinking: { enabled: true, budget: 4000, includeThoughts: true }, // Client format (camelCase logic)
      stream: true
    } as any
    
    // Mock the policy - in real server this comes from upstream-request-builder
    // In this test, we rely on provider.transform() respecting request.thinking.enabled
    
    // @ts-ignore - Accessing protected method or simulating internal flow
    const transformed = provider.transform(request, 'claude-3-7-sonnet-thinking' as ProviderName) as any
    
    // Verify snake_case wire format
    expect(transformed.request).toBeDefined()
    expect(transformed.request.generation_config).toBeDefined()
    expect(transformed.request.generation_config.thinking_config).toBeDefined()
    expect(transformed.request.generation_config.thinking_config.include_thoughts).toBe(true)
    expect(transformed.request.generation_config.thinking_config.thinking_budget_token_count).toBe(4000)
    
    // Verify NO camelCase leaks
    expect(transformed.generationConfig).toBeUndefined()
    expect(transformed.request.generationConfig).toBeUndefined()
    expect(transformed.request.generation_config.thinkingConfig).toBeUndefined()
  })
  
  it('should NOT include thinking config for non-thinking models', () => {
    const provider = new AntigravityProvider({
      apiKey: 'test-key',
      model: 'gpt-4o', // Non-thinking model mapped to AG
    } as any)
    
    const request = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      // Even if client sends thinking config
      thinking: { enabled: true, budget: 4000 },
      stream: false
    } as any
    
    // Policy would be disabled for non-thinking model
    // In this test, we rely on provider.transform() checking model capabilities
    
    // @ts-ignore
    const transformed = provider.transform(request, 'gpt-4o' as ProviderName) as any
    
    expect(transformed.request.generation_config).toBeDefined()
    expect(transformed.request.generation_config.thinking_config).toBeUndefined()
  })

  it('should disable thinking when policy says disabled (e.g. Claude Fresh)', () => {
    const provider = new AntigravityProvider({
      apiKey: 'test-key',
      model: 'claude-3-7-sonnet-thinking',
    } as any)
    
    const request = {
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      thinking: { budget: 4000 },
      stream: true
    } as any
    
    // Simulate Claude Fresh policy (disabled)
    // We simulate this by NOT enabling thinking in the request
    // The pipeline would have stripped this flag if policy said disable
    
    // @ts-ignore
    const transformed = provider.transform(request, 'claude-3-7-sonnet-thinking' as ProviderName) as any
    
    expect(transformed.request.generation_config).toBeDefined()
    expect(transformed.request.generation_config.thinking_config).toBeUndefined()
  })
  
  it('should format Antigravity request correctly matching opencode-antigravity-auth', () => {
      const provider = new AntigravityProvider({
          apiKey: 'test-key',
          model: 'claude-3-7-sonnet-thinking',
      } as any)

      const request = {
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
          thinking: { enabled: true, budget: 1024, includeThoughts: false },
          stream: true
      } as any

      // @ts-ignore
      const transformed = provider.transform(request, 'claude-3-7-sonnet-thinking' as ProviderName) as any

      // Check structure matches opencode-antigravity-auth requirements
      expect(transformed.request_type).toBe('agent')
      expect(transformed.user_agent).toBe('antigravity')
      expect(transformed.request).toBeDefined()
      expect(transformed.request.contents).toBeDefined()
      expect(transformed.request.generation_config).toBeDefined()
      
      // Check thinking config mapping
      const thinking = transformed.request.generation_config.thinking_config
      expect(thinking).toBeDefined()
      expect(thinking.thinking_budget_token_count).toBe(1024)
      expect(thinking.include_thoughts).toBe(false)
  })
})
