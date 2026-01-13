import { describe, expect, it } from 'bun:test'
import type { ModelMapping } from '../../config'
import { applyModelMapping, parseModelMapping, applyModelMappingV2 } from '../model-mapping'

describe('applyModelMapping', () => {
  describe('단일 매핑', () => {
    it('from → to (string) 매핑 적용', () => {
      const mappings: ModelMapping[] = [{ from: 'gpt-4', to: 'custom-gpt-4' }]
      expect(applyModelMapping('gpt-4', mappings)).toBe('custom-gpt-4')
    })

    it('여러 매핑 중 일치하는 매핑 적용', () => {
      const mappings: ModelMapping[] = [
        { from: 'gpt-4', to: 'custom-gpt-4' },
        { from: 'claude-opus', to: 'gemini-claude' },
      ]
      expect(applyModelMapping('claude-opus', mappings)).toBe('gemini-claude')
    })
  })

  describe('배열 매핑', () => {
    it('from → to[0] 첫 번째 사용', () => {
      const mappings: ModelMapping[] = [{ from: 'claude', to: ['model-a', 'model-b'] }]
      expect(applyModelMapping('claude', mappings)).toBe('model-a')
    })

    it('빈 배열일 때 원본 model 반환', () => {
      const mappings: ModelMapping[] = [{ from: 'claude', to: [] }]
      expect(applyModelMapping('claude', mappings)).toBe('claude')
    })
  })

  describe('매핑 없음', () => {
    it('일치하는 매핑이 없을 때 원본 model 반환', () => {
      const mappings: ModelMapping[] = [{ from: 'other', to: 'mapped' }]
      expect(applyModelMapping('gpt-4', mappings)).toBe('gpt-4')
    })
  })

  describe('엣지 케이스', () => {
    it('빈 mappings 배열일 때 원본 model 반환', () => {
      const mappings: ModelMapping[] = []
      expect(applyModelMapping('gpt-4', mappings)).toBe('gpt-4')
    })

    it('undefined mappings일 때 원본 model 반환', () => {
      expect(applyModelMapping('gpt-4', undefined)).toBe('gpt-4')
    })
  })
})

// ============================================================================
// Phase 1: Shorthand Syntax Support (TDD)
// ============================================================================

describe('parseModelMapping', () => {
  it('should NOT parse legacy "model:provider" format (unsupported)', () => {
    const result = parseModelMapping('gpt-5.1:openai')
    expect(result).toEqual({ model: 'gpt-5.1:openai', provider: undefined })
  })

  it('should handle model without provider (passthrough)', () => {
    const result = parseModelMapping('gpt-5.1')
    expect(result).toEqual({ model: 'gpt-5.1', provider: undefined })
  })

  it('should not parse models with colons as provider suffix', () => {
    const result = parseModelMapping('model:with:colons:openai')
    expect(result).toEqual({ model: 'model:with:colons:openai', provider: undefined })
  })

  it('should return whole string as model for "model:" format', () => {
    const result = parseModelMapping('model:')
    expect(result).toEqual({ model: 'model:', provider: undefined })
  })

  // provider/model format tests
  describe('provider/model format', () => {
    it('should parse "provider/model" format', () => {
      const result = parseModelMapping('antigravity/claude-opus-4-5-thinking')
      expect(result).toEqual({ model: 'claude-opus-4-5-thinking', provider: 'antigravity' })
    })

    it('should parse openai-web provider', () => {
      const result = parseModelMapping('openai-web/gpt-5.1')
      expect(result).toEqual({ model: 'gpt-5.1', provider: 'openai-web' })
    })

    it('should parse opencode-zen provider', () => {
      const result = parseModelMapping('opencode-zen/big-pickle')
      expect(result).toEqual({ model: 'big-pickle', provider: 'opencode-zen' })
    })

    it('should parse anthropic provider', () => {
      const result = parseModelMapping('anthropic/claude-3-opus')
      expect(result).toEqual({ model: 'claude-3-opus', provider: 'anthropic' })
    })

    it('should not parse unknown provider/model format', () => {
      const result = parseModelMapping('unknown-provider/some-model')
      expect(result).toEqual({ model: 'unknown-provider/some-model', provider: undefined })
    })

    it('should handle model names with slashes when provider is unknown', () => {
      const result = parseModelMapping('owner/repo-model')
      expect(result).toEqual({ model: 'owner/repo-model', provider: undefined })
    })

    it('should prioritize provider/model over model:provider when both exist', () => {
      const result = parseModelMapping('antigravity/model:suffix')
      expect(result).toEqual({ model: 'model:suffix', provider: 'antigravity' })
    })
  })
})

describe('applyModelMappingV2', () => {
  const mappings: ModelMapping[] = [
    { from: 'claude-opus-4-5-20251101', to: 'antigravity/claude-opus-4-5-thinking' },
    { from: 'gpt-5.1', to: 'openai/gpt-5.1' },
    { from: 'gemini-pro', to: 'gemini/gemini-pro' },
    { from: 'legacy-model', to: 'new-model' },
    { from: 'multi-target', to: ['openai/first-model', 'anthropic/second'] },
  ]

  it('should parse shorthand mapping and return model + provider', () => {
    const result = applyModelMappingV2('gpt-5.1', mappings)
    expect(result).toEqual({ model: 'gpt-5.1', provider: 'openai' })
  })

  it('should parse antigravity mapping', () => {
    const result = applyModelMappingV2('claude-opus-4-5-20251101', mappings)
    expect(result).toEqual({ model: 'claude-opus-4-5-thinking', provider: 'antigravity' })
  })

  it('should parse gemini mapping', () => {
    const result = applyModelMappingV2('gemini-pro', mappings)
    expect(result).toEqual({ model: 'gemini-pro', provider: 'gemini' })
  })

  it('should handle legacy format without provider', () => {
    const result = applyModelMappingV2('legacy-model', mappings)
    expect(result).toEqual({ model: 'new-model', provider: undefined })
  })

  it('should use first element when mapping target is array', () => {
    const result = applyModelMappingV2('multi-target', mappings)
    expect(result).toEqual({ model: 'first-model', provider: 'openai' })
  })

  it('should return original model when no mapping found', () => {
    const result = applyModelMappingV2('unknown-model', mappings)
    expect(result).toEqual({ model: 'unknown-model', provider: undefined })
  })

  it('should return original model when mappings is undefined', () => {
    const result = applyModelMappingV2('any-model', undefined)
    expect(result).toEqual({ model: 'any-model', provider: undefined })
  })

  it('should return original model when mappings is empty', () => {
    const result = applyModelMappingV2('any-model', [])
    expect(result).toEqual({ model: 'any-model', provider: undefined })
  })

  describe('provider/model format support', () => {
    const newFormatMappings: ModelMapping[] = [
      { from: 'claude-opus-4-5-20251101', to: 'antigravity/claude-opus-4-5-thinking' },
      { from: 'gpt-5.1', to: 'openai-web/gpt-5.1' },
      { from: 'big-pickle', to: 'opencode-zen/big-pickle' },
      { from: 'multi-format', to: ['antigravity/model-a', 'openai-web/model-b'] },
    ]

    it('should parse antigravity/model format', () => {
      const result = applyModelMappingV2('claude-opus-4-5-20251101', newFormatMappings)
      expect(result).toEqual({ model: 'claude-opus-4-5-thinking', provider: 'antigravity' })
    })

    it('should parse openai-web/model format', () => {
      const result = applyModelMappingV2('gpt-5.1', newFormatMappings)
      expect(result).toEqual({ model: 'gpt-5.1', provider: 'openai-web' })
    })

    it('should parse opencode-zen/model format', () => {
      const result = applyModelMappingV2('big-pickle', newFormatMappings)
      expect(result).toEqual({ model: 'big-pickle', provider: 'opencode-zen' })
    })

    it('should use first element with provider/model format in array', () => {
      const result = applyModelMappingV2('multi-format', newFormatMappings)
      expect(result).toEqual({ model: 'model-a', provider: 'antigravity' })
    })
  })
})

