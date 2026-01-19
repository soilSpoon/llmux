
import { describe, expect, it } from 'bun:test'
import { AntigravityProvider } from '../../../src/providers/antigravity'
import { CLAUDE_MIN_OUTPUT_TOKENS } from '../../../src/providers/antigravity/constants'
import type { UnifiedRequest } from '../../../src/types/unified'

describe('AntigravityProvider Casing & Logic', () => {
  const provider = new AntigravityProvider()

  const baseRequest: UnifiedRequest = {
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    system: 'System instruction',
    config: {
      temperature: 0.7,
      maxTokens: 1000,
    },
  }

  describe('Claude Models (Antigravity)', () => {
    it('should generate snake_case thinking_config for Claude Thinking models', () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: {
          enabled: true,
          budget: 4000,
          includeThoughts: true,
        },
      }

      const transformed = provider.transform(request, 'antigravity-claude-3-7-sonnet-thinking')
      const innerRequest = transformed.request as any
      const genConfig = innerRequest.generationConfig

      // Verify snake_case keys for Antigravity+Claude
      expect(genConfig).toHaveProperty('thinking_config')
      expect(genConfig).not.toHaveProperty('thinkingConfig')
      expect(genConfig.thinking_config).toEqual({
        include_thoughts: true,
        thinking_budget: 4000,
      })
    })

    it('should enforce MIN_OUTPUT_TOKENS for Claude Thinking models', () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        config: { maxTokens: 100 }, // User set low limit
        thinking: { enabled: true, budget: 1024 },
      }

      const transformed = provider.transform(request, 'antigravity-claude-3-7-sonnet-thinking')
      const innerRequest = transformed.request as any

      expect(innerRequest.generationConfig.maxOutputTokens).toBe(CLAUDE_MIN_OUTPUT_TOKENS)
    })

    it('should NOT generate thinking config for non-thinking Claude models', () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, budget: 1024 }, // Even if user asks (though middleware implies filtering, transform should be safe)
      }

      // Model name without 'thinking' implies no thinking support in this context checks
      // Note: isThinkingModel checks for 'thinking' or 'gemini-3' substring
      const transformed = provider.transform(request, 'claude-3-5-sonnet')
      const innerRequest = transformed.request as any

      expect(innerRequest.generationConfig).not.toHaveProperty('thinking_config')
      expect(innerRequest.generationConfig).not.toHaveProperty('thinkingConfig')
    })
  })

  describe('Gemini Models', () => {
    it('should generate camelCase thinkingConfig with thinkingBudget for Gemini 2.0', () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, budget: 2048 },
      }

      const transformed = provider.transform(request, 'gemini-2.0-flash-thinking')
      const innerRequest = transformed.request as any
      const genConfig = innerRequest.generationConfig

      // Verify camelCase keys for Gemini
      expect(genConfig).toHaveProperty('thinkingConfig')
      expect(genConfig).not.toHaveProperty('thinking_config')
      expect(genConfig.thinkingConfig).toEqual({
        includeThoughts: true, // defaulted to true if enabled is true? or undefined based on logic
        thinkingBudget: 2048,
      })
    })

    it('should generate camelCase thinkingConfig with thinkingLevel for Gemini 3.0 (explicit level)', () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, level: 'high' },
      }

      const transformed = provider.transform(request, 'gemini-3.0-pro')
      const innerRequest = transformed.request as any
      const genConfig = innerRequest.generationConfig

      expect(genConfig.thinkingConfig).toBeDefined()
      expect(genConfig.thinkingConfig.thinkingLevel).toBe('HIGH')
      expect(genConfig.thinkingConfig.thinkingBudget).toBeUndefined()
    })

    it('should map budget to thinkingLevel for Gemini 3.0 (Low budget)', () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, budget: 10000 },
      }

      const transformed = provider.transform(request, 'gemini-3.0-pro')
      const genConfig = (transformed.request as any).generationConfig

      expect(genConfig.thinkingConfig.thinkingLevel).toBe('LOW')
    })

    it('should map budget to thinkingLevel for Gemini 3.0 (Medium budget)', () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, budget: 20000 },
      }

      const transformed = provider.transform(request, 'gemini-3.0-pro')
      const genConfig = (transformed.request as any).generationConfig

      expect(genConfig.thinkingConfig.thinkingLevel).toBe('MEDIUM')
    })

    it('should map budget to thinkingLevel for Gemini 3.0 (High budget)', () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        thinking: { enabled: true, budget: 40000 },
      }

      const transformed = provider.transform(request, 'gemini-3.0-pro')
      const genConfig = (transformed.request as any).generationConfig

      expect(genConfig.thinkingConfig.thinkingLevel).toBe('HIGH')
    })
  })

  describe('General Properties', () => {
    it('should maintain generic camelCase properties for standard fields', () => {
      const request: UnifiedRequest = {
        ...baseRequest,
        config: { stopSequences: ['STOP'] },
        tools: [{ name: 'test_tool', description: 'desc', parameters: { type: 'object' } }],
      }

      const transformed = provider.transform(request, 'any-model')
      const innerRequest = transformed.request as any

      expect(innerRequest.generationConfig).toHaveProperty('stopSequences')
      expect(innerRequest.generationConfig).not.toHaveProperty('stop_sequences')

      expect(innerRequest.tools[0]).toHaveProperty('functionDeclarations')
      expect(innerRequest.tools[0]).not.toHaveProperty('function_declarations')
    })
  })
})
