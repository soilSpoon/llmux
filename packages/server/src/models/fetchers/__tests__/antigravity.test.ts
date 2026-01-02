import { describe, expect, it } from 'bun:test'
import type { Model } from '../../types'
import { ANTIGRAVITY_MODELS, createAntigravityFetcher } from '../antigravity'

describe('AntigravityFetcher', () => {
  describe('ANTIGRAVITY_MODELS', () => {
    it('should export a non-empty array of models', () => {
      expect(ANTIGRAVITY_MODELS).toBeArray()
      expect(ANTIGRAVITY_MODELS.length).toBeGreaterThan(0)
    })

    it('should have models with required fields', () => {
      for (const model of ANTIGRAVITY_MODELS) {
        expect(model.id).toBeString()
        expect(model.provider).toBe('antigravity')
        expect(model.name).toBeString()
        expect(model.object).toBe('model')
      }
    })

    it('should include Gemini models', () => {
      const geminiModels = ANTIGRAVITY_MODELS.filter((m) => m.id.includes('gemini'))
      expect(geminiModels.length).toBeGreaterThan(0)
    })

    it('should include antigravity-claude thinking models', () => {
      const thinkingModels = ANTIGRAVITY_MODELS.filter((m) => m.id.includes('claude') && m.id.includes('thinking'))
      expect(thinkingModels.length).toBeGreaterThan(0)
    })
  })

  describe('createAntigravityFetcher', () => {
    it('should create a fetcher instance', () => {
      const fetcher = createAntigravityFetcher()
      expect(fetcher).toBeDefined()
      expect(fetcher.fetchModels).toBeFunction()
    })

    it('should return hardcoded models without token', async () => {
      const fetcher = createAntigravityFetcher()
      const models = await fetcher.fetchModels()

      expect(models).toEqual(ANTIGRAVITY_MODELS)
    })

    it('should return hardcoded models even with token', async () => {
      const fetcher = createAntigravityFetcher()
      const models = await fetcher.fetchModels('some-token')

      expect(models).toEqual(ANTIGRAVITY_MODELS)
    })

    it('should return models with correct Model type', async () => {
      const fetcher = createAntigravityFetcher()
      const models = await fetcher.fetchModels()

      for (const model of models) {
        expect(model).toMatchObject({
          id: expect.any(String),
          provider: 'antigravity',
          name: expect.any(String),
          object: 'model',
        } satisfies Partial<Model>)
      }
    })
  })
})
