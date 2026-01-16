
import { describe, expect, it, mock } from 'bun:test'
import { FallbackHandler } from '../fallback'
import { AllCooldownError } from '../error-utils'
import type { Router } from '../../routing'

describe('FallbackHandler Cooldown Logic', () => {
  it('should return 429 when Router throws AllCooldownError', async () => {
    // Mock Router
    const mockRouter = {
      resolveModel: mock().mockImplementation(async () => {
        throw new AllCooldownError('All models busy', 'test-provider', 'test-model')
      })
    } as unknown as Router

    // Mock other dependencies
    const mockGetProxy = () => null
    const mockProviderChecker = () => false

    const fallbackHandler = new FallbackHandler(
      mockGetProxy,
      mockProviderChecker,
      undefined, // modelMappings
      mockRouter
    )

    // Dummy handler needed for wrap
    const dummyHandler = async () => new Response('OK')

    const wrappedHandler = fallbackHandler.wrap(dummyHandler)

    // Create a request with a body that allows model extraction
    const request = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'test-model' }),
      headers: { 'Content-Type': 'application/json' }
    })

    const response = await wrappedHandler(request)

    expect(response.status).toBe(429)
    const body = await response.json()
    expect(body).toEqual({
      error: {
        message: 'All models busy',
        type: 'rate_limit_error',
        code: 'all_providers_cooldown'
      }
    })
  })
})
