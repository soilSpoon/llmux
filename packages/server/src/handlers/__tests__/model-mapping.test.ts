import { describe, expect, it } from 'bun:test'
import type { AmpModelMapping } from '../../config'
import { applyModelMapping } from '../model-mapping'

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
