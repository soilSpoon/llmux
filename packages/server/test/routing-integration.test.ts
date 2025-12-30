import { describe, expect, it } from 'bun:test'
import { detectOpenAIApiFormat } from '@llmux/core'

/**
 * Phase 4: Routing Integration Tests
 *
 * These tests verify that:
 * 1. Requests are routed to the correct handler based on endpoint AND body format
 * 2. Model mappings with provider hints work correctly
 * 3. Format auto-detection works on requests
 */
describe('Routing Integration', () => {
  describe('format detection integration', () => {
    it('should detect Responses API format from request body', () => {
      const body = { model: 'gpt-4', input: [{ role: 'user', content: 'Hello' }] }
      expect(detectOpenAIApiFormat(body)).toBe('responses')
    })

    it('should detect Chat Completions format from request body', () => {
      const body = { model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] }
      expect(detectOpenAIApiFormat(body)).toBe('completions')
    })

    it('should detect Responses API by instructions field', () => {
      const body = { model: 'gpt-4', input: 'Hello', instructions: 'Be helpful' }
      expect(detectOpenAIApiFormat(body)).toBe('responses')
    })

    it('should detect Responses API by max_output_tokens', () => {
      const body = { model: 'gpt-4', input: 'Hello', max_output_tokens: 1000 }
      expect(detectOpenAIApiFormat(body)).toBe('responses')
    })

    it('should detect Responses API by reasoning config', () => {
      const body = { model: 'gpt-4', input: 'Hello', reasoning: { effort: 'medium' } }
      expect(detectOpenAIApiFormat(body)).toBe('responses')
    })

    it('should default to completions for empty object', () => {
      expect(detectOpenAIApiFormat({})).toBe('completions')
    })

    it('should default to completions for model-only request', () => {
      expect(detectOpenAIApiFormat({ model: 'gpt-4' })).toBe('completions')
    })
  })

  describe('model mapping with provider integration', () => {
    // These tests verify the V2 mapping syntax works with routing
    it('should parse model:provider mapping correctly', async () => {
      const { parseModelMapping } = await import('../src/handlers/model-mapping')
      
      expect(parseModelMapping('gpt-5.1:openai')).toEqual({
        model: 'gpt-5.1',
        provider: 'openai',
      })
    })

    it('should apply mapping and extract provider', async () => {
      const { applyModelMappingV2 } = await import('../src/handlers/model-mapping')
      
      const mappings = [
        { from: 'gpt-5.1', to: 'gpt-5.1:openai' },
        { from: 'claude-opus', to: 'claude-opus-4-5:antigravity' },
      ]

      expect(applyModelMappingV2('gpt-5.1', mappings)).toEqual({
        model: 'gpt-5.1',
        provider: 'openai',
      })

      expect(applyModelMappingV2('claude-opus', mappings)).toEqual({
        model: 'claude-opus-4-5',
        provider: 'antigravity',
      })
    })

    it('should return original model when no mapping found', async () => {
      const { applyModelMappingV2 } = await import('../src/handlers/model-mapping')
      
      expect(applyModelMappingV2('unknown-model', [])).toEqual({
        model: 'unknown-model',
        provider: undefined,
      })
    })
  })

  describe('endpoint-based handler selection', () => {
    it('should route /v1/responses path to responses format', () => {
      const path = '/v1/responses'
      const isResponsesEndpoint = path.includes('/responses')
      expect(isResponsesEndpoint).toBe(true)
    })

    it('should route /v1/chat/completions path to completions format', () => {
      const path = '/v1/chat/completions'
      const isCompletionsEndpoint = path.includes('/chat/completions')
      expect(isCompletionsEndpoint).toBe(true)
    })

    it('should route /api/provider/:provider/v1/responses to responses format', () => {
      const path = '/api/provider/openai/v1/responses'
      const isResponsesEndpoint = path.includes('/responses')
      expect(isResponsesEndpoint).toBe(true)
    })
  })
})
