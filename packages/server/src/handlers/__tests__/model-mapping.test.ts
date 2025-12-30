import { describe, expect, it } from 'bun:test'
import type { AmpModelMapping } from '../../config'
import { applyModelMapping, parseModelMapping, applyModelMappingV2 } from '../model-mapping'

describe('applyModelMapping', () => {
  describe('단일 매핑', () => {
    it('from → to (string) 매핑 적용', () => {
      const mappings: AmpModelMapping[] = [{ from: 'gpt-4', to: 'custom-gpt-4' }]
      expect(applyModelMapping('gpt-4', mappings)).toBe('custom-gpt-4')
    })

    it('여러 매핑 중 일치하는 매핑 적용', () => {
      const mappings: AmpModelMapping[] = [
        { from: 'gpt-4', to: 'custom-gpt-4' },
        { from: 'claude-opus', to: 'gemini-claude' },
      ]
      expect(applyModelMapping('claude-opus', mappings)).toBe('gemini-claude')
    })
  })

  describe('배열 매핑', () => {
    it('from → to[0] 첫 번째 사용', () => {
      const mappings: AmpModelMapping[] = [{ from: 'claude', to: ['model-a', 'model-b'] }]
      expect(applyModelMapping('claude', mappings)).toBe('model-a')
    })

    it('빈 배열일 때 원본 model 반환', () => {
      const mappings: AmpModelMapping[] = [{ from: 'claude', to: [] }]
      expect(applyModelMapping('claude', mappings)).toBe('claude')
    })
  })

  describe('매핑 없음', () => {
    it('일치하는 매핑이 없을 때 원본 model 반환', () => {
      const mappings: AmpModelMapping[] = [{ from: 'other', to: 'mapped' }]
      expect(applyModelMapping('gpt-4', mappings)).toBe('gpt-4')
    })
  })

  describe('엣지 케이스', () => {
    it('빈 mappings 배열일 때 원본 model 반환', () => {
      const mappings: AmpModelMapping[] = []
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
  it('should parse shorthand format "model:provider"', () => {
    const result = parseModelMapping('gpt-5.1:openai')
    expect(result).toEqual({ model: 'gpt-5.1', provider: 'openai' })
  })

  it('should handle model with provider containing hyphens', () => {
    const result = parseModelMapping('claude-opus-4-5:antigravity')
    expect(result).toEqual({ model: 'claude-opus-4-5', provider: 'antigravity' })
  })

  it('should handle model without provider (passthrough)', () => {
    const result = parseModelMapping('gpt-5.1')
    expect(result).toEqual({ model: 'gpt-5.1', provider: undefined })
  })

  it('should handle model with colons in name (split on last colon)', () => {
    const result = parseModelMapping('model:with:colons:openai')
    expect(result).toEqual({ model: 'model:with:colons', provider: 'openai' })
  })

  it('should return undefined provider for empty string after colon', () => {
    const result = parseModelMapping('model:')
    expect(result).toEqual({ model: 'model', provider: undefined })
  })
})

describe('applyModelMappingV2', () => {
  const mappings: AmpModelMapping[] = [
    { from: 'claude-opus-4-5-20251101', to: 'claude-opus-4-5-thinking:antigravity' },
    { from: 'gpt-5.1', to: 'gpt-5.1:openai' },
    { from: 'gemini-pro', to: 'gemini-pro:gemini' },
    { from: 'legacy-model', to: 'new-model' },
    { from: 'multi-target', to: ['first-model:openai', 'second:anthropic'] },
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
})

