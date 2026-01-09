import { describe, it, expect, beforeEach, mock, beforeAll, afterAll } from 'bun:test'
import { fetchAntigravityProjectIDAndTier, invalidateProjectContextCache } from './antigravity-oauth'

/**
 * Helper to create a properly typed fetch mock for tests.
 * Adds the `preconnect` method required by Bun's fetch type.
 */
function createFetchMock(responseFactory: () => Partial<Response> | Promise<Partial<Response>>) {
  const mockFn = mock(() => Promise.resolve(responseFactory()) as Promise<Response>)
  // Add the preconnect method required by newer Bun versions
  return Object.assign(mockFn, { preconnect: () => {} }) as unknown as typeof fetch
}

/**
 * Helper to create a stateful fetch mock that can track attempts
 */
function createStatefulFetchMock(handler: (attemptCount: number) => Partial<Response>) {
  let attemptCount = 0
  const mockFn = mock(() => {
    attemptCount++
    return Promise.resolve(handler(attemptCount)) as Promise<Response>
  })
  return Object.assign(mockFn, { preconnect: () => {} }) as unknown as typeof fetch
}

describe('antigravity-oauth', () => {
  let originalFetch: typeof fetch

  beforeAll(() => {
    originalFetch = global.fetch
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  describe('fetchAntigravityProjectIDAndTier', () => {
    beforeEach(() => {
      mock.restore?.()
      invalidateProjectContextCache()
    })

    it('should detect free tier from legacy-tier ID', async () => {
      const mockResponse = {
        cloudaicompanionProject: { id: 'test-project-123' },
        allowedTiers: [{ id: 'legacy-tier', name: 'Legacy Free Tier' }],
      }

      global.fetch = createFetchMock(() => ({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }))

      const result = await fetchAntigravityProjectIDAndTier('test-token')

      expect(result).toEqual({
        projectId: 'test-project-123',
        tier: 'free',
      })
    })

    it('should detect free tier from *-free suffix in tier ID', async () => {
      const mockResponse = {
        cloudaicompanionProject: { id: 'test-project-456' },
        allowedTiers: [{ id: 'gemini-free', name: 'Free Tier' }],
      }

      global.fetch = createFetchMock(() => ({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }))

      const result = await fetchAntigravityProjectIDAndTier('test-token')

      expect(result).toEqual({
        projectId: 'test-project-456',
        tier: 'free',
      })
    })

    it('should detect paid tier from non-free tier IDs', async () => {
      const mockResponse = {
        cloudaicompanionProject: { id: 'test-project-789' },
        allowedTiers: [{ id: 'premium-pro', name: 'Premium Pro' }],
      }

      global.fetch = createFetchMock(() => ({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }))

      const result = await fetchAntigravityProjectIDAndTier('test-token')

      expect(result).toEqual({
        projectId: 'test-project-789',
        tier: 'paid',
      })
    })

    it('should handle multiple tiers and select the first (paid takes priority)', async () => {
      const mockResponse = {
        cloudaicompanionProject: { id: 'test-project-multi' },
        allowedTiers: [
          { id: 'premium', name: 'Premium' },
          { id: 'legacy-tier', name: 'Legacy Free' },
        ],
      }

      global.fetch = createFetchMock(() => ({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }))

      const result = await fetchAntigravityProjectIDAndTier('test-token')

      expect(result).toEqual({
        projectId: 'test-project-multi',
        tier: 'paid',
      })
    })

    it('should handle missing allowedTiers gracefully', async () => {
      const mockResponse = {
        cloudaicompanionProject: { id: 'test-project-notierdata' },
      }

      global.fetch = createFetchMock(() => ({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }))

      const result = await fetchAntigravityProjectIDAndTier('test-token')

      expect(result).toEqual({
        projectId: 'test-project-notierdata',
        tier: undefined,
      })
    })

    it('should return empty project ID but infer tier from response', async () => {
      const mockResponse = {
        allowedTiers: [{ id: 'enterprise', name: 'Enterprise' }],
      }

      global.fetch = createFetchMock(() => ({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }))

      const result = await fetchAntigravityProjectIDAndTier('test-token')

      expect(result).toEqual({
        projectId: '',
        tier: 'paid',
      })
    })

    it('should return undefined tier if allowedTiers is empty', async () => {
      const mockResponse = {
        cloudaicompanionProject: { id: 'test-project' },
        allowedTiers: [],
      }

      global.fetch = createFetchMock(() => ({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }))

      const result = await fetchAntigravityProjectIDAndTier('test-token')

      expect(result).toEqual({
        projectId: 'test-project',
        tier: undefined,
      })
    })

    it('should handle API errors gracefully', async () => {
      global.fetch = createFetchMock(() => ({
        ok: false,
        status: 500,
      }))

      const result = await fetchAntigravityProjectIDAndTier('test-token')

      expect(result).toEqual({
        projectId: '',
        tier: undefined,
      })
    })

    it('should try multiple endpoints on failure', async () => {
      global.fetch = createStatefulFetchMock((attemptCount) => {
        if (attemptCount === 1) {
          return { ok: false }
        }
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              cloudaicompanionProject: { id: 'fallback-project' },
              allowedTiers: [{ id: 'pro', name: 'Professional' }],
            }),
        }
      })

      const result = await fetchAntigravityProjectIDAndTier('test-token')

      expect(result.projectId).toBe('fallback-project')
      expect(result.tier).toBe('paid')
    })
  })
})
