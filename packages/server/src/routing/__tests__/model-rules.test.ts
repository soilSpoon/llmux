import { describe, expect, it } from 'bun:test'
import { parseExplicitProvider } from '../model-rules'

describe('parseExplicitProvider', () => {
  describe('model:provider format (legacy)', () => {
    it('should parse model:provider format', () => {
      const result = parseExplicitProvider('claude-3-opus:antigravity')
      expect(result).toEqual({ model: 'claude-3-opus', provider: 'antigravity' })
    })

    it('should parse openai provider', () => {
      const result = parseExplicitProvider('gpt-4:openai')
      expect(result).toEqual({ model: 'gpt-4', provider: 'openai' })
    })

    it('should parse anthropic provider', () => {
      const result = parseExplicitProvider('claude-opus:anthropic')
      expect(result).toEqual({ model: 'claude-opus', provider: 'anthropic' })
    })

    it('should return model without provider when no colon', () => {
      const result = parseExplicitProvider('gpt-4')
      expect(result).toEqual({ model: 'gpt-4', provider: undefined })
    })

    it('should handle model with multiple colons (use last colon)', () => {
      const result = parseExplicitProvider('model:with:colons:openai')
      expect(result).toEqual({ model: 'model:with:colons', provider: 'openai' })
    })

    it('should not parse unknown provider suffix', () => {
      const result = parseExplicitProvider('model:unknown-provider')
      expect(result).toEqual({ model: 'model:unknown-provider', provider: undefined })
    })
  })

  describe('provider/model format (new)', () => {
    it('should parse antigravity/model format', () => {
      const result = parseExplicitProvider('antigravity/claude-opus-4-5-thinking')
      expect(result).toEqual({ model: 'claude-opus-4-5-thinking', provider: 'antigravity' })
    })

    it('should parse openai-web/model format', () => {
      const result = parseExplicitProvider('openai-web/gpt-5.1')
      expect(result).toEqual({ model: 'gpt-5.1', provider: 'openai-web' })
    })

    it('should parse opencode-zen/model format', () => {
      const result = parseExplicitProvider('opencode-zen/big-pickle')
      expect(result).toEqual({ model: 'big-pickle', provider: 'opencode-zen' })
    })

    it('should parse anthropic/model format', () => {
      const result = parseExplicitProvider('anthropic/claude-3-opus')
      expect(result).toEqual({ model: 'claude-3-opus', provider: 'anthropic' })
    })

    it('should parse openai/model format', () => {
      const result = parseExplicitProvider('openai/gpt-4')
      expect(result).toEqual({ model: 'gpt-4', provider: 'openai' })
    })

    it('should parse gemini/model format', () => {
      const result = parseExplicitProvider('gemini/gemini-pro')
      expect(result).toEqual({ model: 'gemini-pro', provider: 'gemini' })
    })

    it('should parse github-copilot/model format', () => {
      const result = parseExplicitProvider('github-copilot/copilot-model')
      expect(result).toEqual({ model: 'copilot-model', provider: 'github-copilot' })
    })

    it('should not parse unknown provider prefix', () => {
      const result = parseExplicitProvider('unknown-provider/some-model')
      expect(result).toEqual({ model: 'unknown-provider/some-model', provider: undefined })
    })

    it('should handle model names like owner/repo (no known provider)', () => {
      const result = parseExplicitProvider('huggingface/model-name')
      expect(result).toEqual({ model: 'huggingface/model-name', provider: undefined })
    })

    it('should prioritize provider/model over model:provider', () => {
      const result = parseExplicitProvider('antigravity/model:with:colons')
      expect(result).toEqual({ model: 'model:with:colons', provider: 'antigravity' })
    })

    it('should handle empty model after provider/', () => {
      const result = parseExplicitProvider('antigravity/')
      expect(result).toEqual({ model: 'antigravity/', provider: undefined })
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = parseExplicitProvider('')
      expect(result).toEqual({ model: '', provider: undefined })
    })

    it('should handle just a slash', () => {
      const result = parseExplicitProvider('/')
      expect(result).toEqual({ model: '/', provider: undefined })
    })

    it('should handle just a colon', () => {
      const result = parseExplicitProvider(':')
      expect(result).toEqual({ model: ':', provider: undefined })
    })
  })
})
