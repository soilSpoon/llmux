import { describe, expect, it } from 'bun:test'
import { createFetcher, getFetcherStrategy } from '../index'

describe('FetcherFactory', () => {
  describe('getFetcherStrategy', () => {
    it("should return 'hardcoded' for antigravity", () => {
      expect(getFetcherStrategy('antigravity')).toBe('hardcoded')
    })

    it("should return 'api' for github-copilot", () => {
      expect(getFetcherStrategy('github-copilot')).toBe('api')
    })

    it("should return 'models-dev' for other providers", () => {
      expect(getFetcherStrategy('openai')).toBe('models-dev')
      expect(getFetcherStrategy('anthropic')).toBe('models-dev')
      expect(getFetcherStrategy('opencode-zen')).toBe('models-dev')
      expect(getFetcherStrategy('gemini')).toBe('models-dev')
    })
  })

  describe('createFetcher', () => {
    it('should create fetcher for antigravity', () => {
      const fetcher = createFetcher('antigravity')
      expect(fetcher).toBeDefined()
      expect(fetcher.fetchModels).toBeFunction()
    })

    it('should create fetcher for github-copilot', () => {
      const fetcher = createFetcher('github-copilot')
      expect(fetcher).toBeDefined()
      expect(fetcher.fetchModels).toBeFunction()
    })

    it('should create fetcher for other providers', () => {
      const fetcher = createFetcher('openai')
      expect(fetcher).toBeDefined()
      expect(fetcher.fetchModels).toBeFunction()
    })

    it('should create fetcher for opencode-zen mapped to opencode', () => {
      const fetcher = createFetcher('opencode-zen')
      expect(fetcher).toBeDefined()
      expect(fetcher.fetchModels).toBeFunction()
    })
  })
})
