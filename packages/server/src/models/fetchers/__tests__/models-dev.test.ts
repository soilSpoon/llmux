import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { ModelCache } from '../../cache'
import type { Model } from '../../types'
import { createModelsDevFetcher, MODELS_DEV_API_URL } from '../models-dev'

describe('ModelsDevFetcher', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('MODELS_DEV_API_URL', () => {
    it('should export the correct API URL', () => {
      expect(MODELS_DEV_API_URL).toBe('https://models.dev/api.json')
    })
  })

  describe('createModelsDevFetcher', () => {
    const createMockCache = (): ModelCache => ({
      get: mock(async () => null),
      set: mock(async () => {}),
      isExpired: mock(async () => true),
      clear: mock(async () => {}),
    })

    it('should create a fetcher instance', () => {
      const fetcher = createModelsDevFetcher('opencode-zen')
      expect(fetcher).toBeDefined()
      expect(fetcher.fetchModels).toBeFunction()
    })

    it('should return cached models when not expired', async () => {
      const cachedModels: Model[] = [
        { id: 'gpt-4', provider: 'opencode-zen', name: 'GPT-4', object: 'model' },
      ]

      const cache: ModelCache = {
        get: mock(async () => cachedModels),
        set: mock(async () => {}),
        isExpired: mock(async () => false),
        clear: mock(async () => {}),
      }

      const fetcher = createModelsDevFetcher('opencode-zen', cache)
      const models = await fetcher.fetchModels()

      expect(models).toEqual(cachedModels)
      expect(cache.get).toHaveBeenCalledTimes(1)
    })

    it('should fetch from API when cache is expired', async () => {
      const mockApiResponse = {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: ['OPENAI_API_KEY'],
          models: {
            'gpt-4o': {
              id: 'gpt-4o',
              name: 'GPT-4o',
              release_date: '2024-05-13',
              attachment: true,
              reasoning: false,
              temperature: true,
              tool_call: true,
              limit: { context: 128000, output: 16384 },
              options: {},
            },
          },
        },
      }

      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify(mockApiResponse), { status: 200 })
      }) as unknown as typeof fetch

      const cache: ModelCache = {
        get: mock(async () => null),
        set: mock(async () => {}),
        isExpired: mock(async () => true),
        clear: mock(async () => {}),
      }

      const fetcher = createModelsDevFetcher('openai', cache)
      const models = await fetcher.fetchModels()

      expect(models).toHaveLength(1)
      expect(models[0]).toMatchObject({
        id: 'gpt-4o',
        provider: 'openai',
        name: 'GPT-4o',
        object: 'model',
        context_length: 128000,
        max_completion_tokens: 16384,
      })
      expect(cache.set).toHaveBeenCalledTimes(1)
    })

    it('should filter models by provider id', async () => {
      const mockApiResponse = {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: [],
          models: {
            'gpt-4o': {
              id: 'gpt-4o',
              name: 'GPT-4o',
              release_date: '2024-05-13',
              attachment: true,
              reasoning: false,
              temperature: true,
              tool_call: true,
              limit: { context: 128000, output: 16384 },
              options: {},
            },
          },
        },
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          env: [],
          models: {
            'claude-3-opus': {
              id: 'claude-3-opus',
              name: 'Claude 3 Opus',
              release_date: '2024-03-04',
              attachment: true,
              reasoning: false,
              temperature: true,
              tool_call: true,
              limit: { context: 200000, output: 4096 },
              options: {},
            },
          },
        },
      }

      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify(mockApiResponse), { status: 200 })
      }) as unknown as typeof fetch

      const cache = createMockCache()
      const fetcher = createModelsDevFetcher('openai', cache)
      const models = await fetcher.fetchModels()

      expect(models).toHaveLength(1)
      expect(models[0]?.id).toBe('gpt-4o')
    })

    it('should return empty array on API error', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('Internal Server Error', { status: 500 })
      }) as unknown as typeof fetch

      const cache = createMockCache()
      const fetcher = createModelsDevFetcher('openai', cache)
      const models = await fetcher.fetchModels()

      expect(models).toEqual([])
    })

    it('should return empty array when provider not found', async () => {
      const mockApiResponse = {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: [],
          models: {},
        },
      }

      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify(mockApiResponse), { status: 200 })
      }) as unknown as typeof fetch

      const cache = createMockCache()
      const fetcher = createModelsDevFetcher('unknown-provider', cache)
      const models = await fetcher.fetchModels()

      expect(models).toEqual([])
    })

    it('should work without cache (fetch directly)', async () => {
      const mockApiResponse = {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: [],
          models: {
            'gpt-4o': {
              id: 'gpt-4o',
              name: 'GPT-4o',
              release_date: '2024-05-13',
              attachment: true,
              reasoning: false,
              temperature: true,
              tool_call: true,
              limit: { context: 128000, output: 16384 },
              options: {},
            },
          },
        },
      }

      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify(mockApiResponse), { status: 200 })
      }) as unknown as typeof fetch

      const fetcher = createModelsDevFetcher('openai')
      const models = await fetcher.fetchModels()

      expect(models).toHaveLength(1)
    })
  })
})
