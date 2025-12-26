import { afterEach, describe, expect, it, mock } from 'bun:test'
import { createGithubCopilotFetcher, GITHUB_COPILOT_API_URL } from '../github-copilot'

describe('GithubCopilotFetcher', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('GITHUB_COPILOT_API_URL', () => {
    it('should export the correct API URL', () => {
      expect(GITHUB_COPILOT_API_URL).toBe('https://api.githubcopilot.com')
    })
  })

  describe('createGithubCopilotFetcher', () => {
    it('should create a fetcher instance', () => {
      const fetcher = createGithubCopilotFetcher()
      expect(fetcher).toBeDefined()
      expect(fetcher.fetchModels).toBeFunction()
    })

    it('should return empty array without token', async () => {
      const fetcher = createGithubCopilotFetcher()
      const models = await fetcher.fetchModels()
      expect(models).toEqual([])
    })

    it('should call API with Bearer token', async () => {
      let capturedHeaders: Headers | undefined
      let capturedUrl: string | undefined

      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = url.toString()
        capturedHeaders = init?.headers as Headers
        return new Response(JSON.stringify({ object: 'list', data: [] }), {
          status: 200,
        })
      }) as unknown as typeof fetch

      const fetcher = createGithubCopilotFetcher()
      await fetcher.fetchModels('test-token-123')

      expect(capturedUrl).toBe('https://api.githubcopilot.com/models')
      expect(capturedHeaders?.get('Authorization')).toBe('Bearer test-token-123')
    })

    it('should include required Copilot headers', async () => {
      let capturedHeaders: Headers | undefined

      globalThis.fetch = mock(async (_, init) => {
        capturedHeaders = init?.headers as Headers
        return new Response(JSON.stringify({ object: 'list', data: [] }), {
          status: 200,
        })
      }) as unknown as typeof fetch

      const fetcher = createGithubCopilotFetcher()
      await fetcher.fetchModels('test-token')

      expect(capturedHeaders?.get('Content-Type')).toBe('application/json')
      expect(capturedHeaders?.get('Editor-Version')).toBeString()
      expect(capturedHeaders?.get('User-Agent')).toContain('GithubCopilot')
    })

    it('should parse models from API response', async () => {
      const mockApiResponse = {
        object: 'list',
        data: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            created: 1715558400,
            context_length: 128000,
            max_completion_tokens: 16384,
          },
          {
            id: 'claude-3.5-sonnet',
            name: 'Claude 3.5 Sonnet',
            created: 1718928000,
            context_length: 200000,
            max_completion_tokens: 8192,
          },
        ],
      }

      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify(mockApiResponse), { status: 200 })
      }) as unknown as typeof fetch

      const fetcher = createGithubCopilotFetcher()
      const models = await fetcher.fetchModels('test-token')

      expect(models).toHaveLength(2)
      expect(models[0]).toMatchObject({
        id: 'gpt-4o',
        provider: 'github-copilot',
        name: 'GPT-4o',
        object: 'model',
        context_length: 128000,
        max_completion_tokens: 16384,
      })
      expect(models[1]).toMatchObject({
        id: 'claude-3.5-sonnet',
        provider: 'github-copilot',
        name: 'Claude 3.5 Sonnet',
      })
    })

    it('should return empty array on API error', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('Internal Server Error', { status: 500 })
      }) as unknown as typeof fetch

      const fetcher = createGithubCopilotFetcher()
      const models = await fetcher.fetchModels('test-token')

      expect(models).toEqual([])
    })

    it('should return empty array on network error', async () => {
      globalThis.fetch = mock(async () => {
        throw new Error('Network error')
      }) as unknown as typeof fetch

      const fetcher = createGithubCopilotFetcher()
      const models = await fetcher.fetchModels('test-token')

      expect(models).toEqual([])
    })

    it('should return empty array on invalid JSON response', async () => {
      globalThis.fetch = mock(async () => {
        return new Response('not json', { status: 200 })
      }) as unknown as typeof fetch

      const fetcher = createGithubCopilotFetcher()
      const models = await fetcher.fetchModels('test-token')

      expect(models).toEqual([])
    })

    it('should handle missing data array in response', async () => {
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ object: 'list' }), {
          status: 200,
        })
      }) as unknown as typeof fetch

      const fetcher = createGithubCopilotFetcher()
      const models = await fetcher.fetchModels('test-token')

      expect(models).toEqual([])
    })
  })
})
