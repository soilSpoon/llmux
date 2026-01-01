import { describe, it, expect } from 'bun:test'
import type { ThinkingConfig } from '../../src/types/unified'

describe('ThinkingConfig', () => {
  describe('Basic types', () => {
    it('should create minimal config with only enabled field', () => {
      const config: ThinkingConfig = {
        enabled: true,
      }
      expect(config.enabled).toBe(true)
      expect(config.budget).toBeUndefined()
      expect(config.effort).toBeUndefined()
    })

    it('should create disabled config', () => {
      const config: ThinkingConfig = {
        enabled: false,
      }
      expect(config.enabled).toBe(false)
    })
  })

  describe('Effort levels', () => {
    it('should accept valid effort levels', () => {
      const levels: Array<'none' | 'low' | 'medium' | 'high'> = [
        'none',
        'low',
        'medium',
        'high',
      ]

      for (const level of levels) {
        const config: ThinkingConfig = {
          enabled: true,
          effort: level,
        }
        expect(config.effort).toBe(level)
      }
    })

    it('should allow undefined effort', () => {
      const config: ThinkingConfig = {
        enabled: true,
      }
      expect(config.effort).toBeUndefined()
    })
  })

  describe('Budget tokens', () => {
    it('should accept budget token values', () => {
      const config: ThinkingConfig = {
        enabled: true,
        budget: 10000,
      }
      expect(config.budget).toBe(10000)
    })

    it('should allow undefined budget', () => {
      const config: ThinkingConfig = {
        enabled: true,
      }
      expect(config.budget).toBeUndefined()
    })
  })

  describe('Preserve context', () => {
    it('should accept preserveContext flag', () => {
      const config: ThinkingConfig = {
        enabled: true,
        preserveContext: true,
      }
      expect(config.preserveContext).toBe(true)
    })

    it('should allow preserveContext false', () => {
      const config: ThinkingConfig = {
        enabled: true,
        preserveContext: false,
      }
      expect(config.preserveContext).toBe(false)
    })

    it('should allow undefined preserveContext', () => {
      const config: ThinkingConfig = {
        enabled: true,
      }
      expect(config.preserveContext).toBeUndefined()
    })
  })

  describe('Include thoughts', () => {
    it('should accept includeThoughts flag', () => {
      const config: ThinkingConfig = {
        enabled: true,
        includeThoughts: true,
      }
      expect(config.includeThoughts).toBe(true)
    })

    it('should allow includeThoughts false', () => {
      const config: ThinkingConfig = {
        enabled: true,
        includeThoughts: false,
      }
      expect(config.includeThoughts).toBe(false)
    })

    it('should allow undefined includeThoughts', () => {
      const config: ThinkingConfig = {
        enabled: true,
      }
      expect(config.includeThoughts).toBeUndefined()
    })
  })

  describe('Combined configurations', () => {
    it('should support enabled with effort and budget', () => {
      const config: ThinkingConfig = {
        enabled: true,
        effort: 'high',
        budget: 15000,
      }
      expect(config.enabled).toBe(true)
      expect(config.effort).toBe('high')
      expect(config.budget).toBe(15000)
    })

    it('should support enabled with preserveContext and includeThoughts', () => {
      const config: ThinkingConfig = {
        enabled: true,
        preserveContext: true,
        includeThoughts: true,
      }
      expect(config.enabled).toBe(true)
      expect(config.preserveContext).toBe(true)
      expect(config.includeThoughts).toBe(true)
    })

    it('should support full config with all fields', () => {
      const config: ThinkingConfig = {
        enabled: true,
        effort: 'medium',
        budget: 8000,
        preserveContext: true,
        includeThoughts: false,
      }
      expect(config.enabled).toBe(true)
      expect(config.effort).toBe('medium')
      expect(config.budget).toBe(8000)
      expect(config.preserveContext).toBe(true)
      expect(config.includeThoughts).toBe(false)
    })

    it('should support disabled with other fields (backward compatibility)', () => {
      const config: ThinkingConfig = {
        enabled: false,
        effort: 'none',
        budget: 0,
      }
      expect(config.enabled).toBe(false)
    })
  })

  describe('Disabled configurations', () => {
    it('should create minimal disabled config', () => {
      const config: ThinkingConfig = {
        enabled: false,
      }
      expect(config.enabled).toBe(false)
    })

    it('should support disabled with effort none', () => {
      const config: ThinkingConfig = {
        enabled: false,
        effort: 'none',
      }
      expect(config.enabled).toBe(false)
      expect(config.effort).toBe('none')
    })

    it('should support disabled with preserveContext', () => {
      const config: ThinkingConfig = {
        enabled: false,
        preserveContext: false,
      }
      expect(config.enabled).toBe(false)
      expect(config.preserveContext).toBe(false)
    })
  })
})
