import { describe, expect, it } from 'bun:test'
import { ANTIGRAVITY_MODELS } from '../models/fetchers/antigravity'

describe('Antigravity 모델명 검증 (TDD)', () => {
  describe('ANTIGRAVITY_MODELS', () => {
    it('should only contain working model IDs (no broken G3 variants)', () => {
      const ids = ANTIGRAVITY_MODELS.map(m => m.id)
      
      // Should exist (Official IDs)
      expect(ids).toContain('gemini-3-pro-high')
      expect(ids).toContain('gemini-3-pro-low')
      expect(ids).toContain('gemini-3-flash-preview')
      
      // Should NOT exist (Broken or unofficial IDs)
      expect(ids).not.toContain('gemini-3-pro-preview')
      
      // Claude models
      expect(ids.some(id => id.includes('claude'))).toBe(true)
    })
  })

  // Note: applyAntigravityAlias is planned to be removed.
  // We will keep this block commented out or remove it to ensure it fails if called.
})
