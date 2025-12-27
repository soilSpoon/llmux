import { describe, expect, test } from 'bun:test'
import { createRouter, Router } from '../src/routing'

describe('Router (Routing)', () => {
  describe('resolveModel', () => {
    test('returns mapped provider and model when mapping exists', () => {
      const router = createRouter({
        modelMapping: {
          'gpt-4': { provider: 'openai', model: 'gpt-4-turbo' },
          'claude-3': { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        },
      })

      const result = router.resolveModel('gpt-4')
      expect(result.provider).toBe('openai')
      expect(result.model).toBe('gpt-4-turbo')
    })

    test('returns first fallback provider when no mapping exists', () => {
      const router = createRouter({
        fallbackOrder: ['anthropic', 'openai'],
      })

      const result = router.resolveModel('unknown-model')
      expect(result.provider).toBe('anthropic')
      expect(result.model).toBe('unknown-model')
    })

    test('defaults to openai when no fallbackOrder set', () => {
      const router = createRouter({})

      const result = router.resolveModel('some-model')
      expect(result.provider).toBe('openai')
      expect(result.model).toBe('some-model')
    })
  })

  describe('getNextProvider', () => {
    test('returns undefined when no fallback order', () => {
      const router = createRouter({})
      expect(router.getNextProvider()).toBeUndefined()
    })

    test('rotates through fallback order', () => {
      const router = createRouter({
        fallbackOrder: ['anthropic', 'openai', 'gemini'],
      })

      expect(router.getNextProvider()).toBe('anthropic')
      expect(router.getNextProvider()).toBe('openai')
      expect(router.getNextProvider()).toBe('gemini')
      expect(router.getNextProvider()).toBe('anthropic')
    })

    test('resetRotation resets the index', () => {
      const router = createRouter({
        fallbackOrder: ['anthropic', 'openai'],
      })

      router.getNextProvider()
      router.getNextProvider()
      router.resetRotation()

      expect(router.getNextProvider()).toBe('anthropic')
    })
  })

  describe('shouldRotateOn429', () => {
    test('returns false by default', () => {
      const router = createRouter({})
      expect(router.shouldRotateOn429()).toBe(false)
    })

    test('returns true when enabled', () => {
      const router = createRouter({
        rotateOn429: true,
      })
      expect(router.shouldRotateOn429()).toBe(true)
    })
  })

  describe('handleRateLimit', () => {
    test('returns undefined when rotateOn429 is false', () => {
      const router = createRouter({
        rotateOn429: false,
        fallbackOrder: ['anthropic', 'openai'],
      })

      expect(router.handleRateLimit()).toBeUndefined()
    })

    test('returns next provider when rotateOn429 is true', () => {
      const router = createRouter({
        rotateOn429: true,
        fallbackOrder: ['anthropic', 'openai', 'gemini'],
      })

      expect(router.getNextProvider()).toBe('anthropic')
      expect(router.getNextProvider()).toBe('openai')
    })
  })

  describe('Router class', () => {
    test('can be instantiated directly', () => {
      const router = new Router({
        fallbackOrder: ['gemini'],
      })

      const result = router.resolveModel('test')
      expect(result.provider).toBe('gemini')
    })
  })
})
