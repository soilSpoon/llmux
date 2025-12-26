import { describe, expect, it } from 'bun:test'
import type { Model, ModelProvider, ModelsResponse } from '../types'

describe('Model Types', () => {
  describe('Model', () => {
    it('should have required id and provider fields', () => {
      const model: Model = {
        id: 'gpt-4',
        provider: 'openai',
        name: 'GPT-4',
        object: 'model',
      }

      expect(model.id).toBe('gpt-4')
      expect(model.provider).toBe('openai')
      expect(model.name).toBe('GPT-4')
      expect(model.object).toBe('model')
    })

    it('should support optional context_length and max_completion_tokens', () => {
      const model: Model = {
        id: 'claude-3-opus',
        provider: 'anthropic',
        name: 'Claude 3 Opus',
        object: 'model',
        context_length: 200000,
        max_completion_tokens: 4096,
      }

      expect(model.context_length).toBe(200000)
      expect(model.max_completion_tokens).toBe(4096)
    })
  })

  describe('ModelProvider', () => {
    it('should include known provider types', () => {
      const providers: ModelProvider[] = [
        'antigravity',
        'github-copilot',
        'opencode-zen',
        'openai',
        'anthropic',
        'gemini',
      ]

      expect(providers).toContain('antigravity')
      expect(providers).toContain('github-copilot')
      expect(providers).toContain('opencode-zen')
    })
  })

  describe('ModelsResponse', () => {
    it('should have OpenAI-compatible structure', () => {
      const response: ModelsResponse = {
        object: 'list',
        data: [
          {
            id: 'gpt-4',
            provider: 'openai',
            name: 'GPT-4',
            object: 'model',
          },
        ],
        providers: ['openai'],
      }

      expect(response.object).toBe('list')
      expect(response.data).toHaveLength(1)
      expect(response.providers).toContain('openai')
    })
  })
})
