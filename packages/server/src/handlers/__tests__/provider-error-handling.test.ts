import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import '../../../test/setup'
import { ANTIGRAVITY_ENDPOINT_FALLBACKS, TokenRefresh, CredentialStorage } from '@llmux/auth'
import { accountRotationManager } from '../account-rotation'
import { rateLimitStore } from '../rate-limit-store'
import {
  createRetryState,
  handleUpstreamError,
  type ErrorHandlingContext,
  type RetryState,
} from '../request-handler'
import { AntigravityErrorStrategy } from '../../strategies/antigravity'
import { ANTIGRAVITY_DEFAULT_PROJECT_ID } from '../../providers/antigravity'
import { registerServerStrategies } from '../../strategies/register'
import type { Router } from '../../routing'

function createMockRetryState(overrides: Partial<RetryState> = {}): RetryState {
  return {
    attempt: 0,
    accountIndex: -1,
    antigravityEndpointIndex: 0,
    overrideProjectId: null,
    maxRetryAttempts: 40,
    ...overrides,
  }
}

function createMockErrorContext(overrides: Partial<ErrorHandlingContext> = {}): ErrorHandlingContext {
  return {
    reqId: 'test-req-id',
    provider: 'antigravity',
    model: 'gemini-2.5-pro',
    status: 500,
    errorText: 'Internal Server Error',
    retryState: createMockRetryState(),
    ...overrides,
  }
}

describe('RetryState mutations', () => {
  it('should increment accountIndex', () => {
    const state = createMockRetryState({ accountIndex: 0 })
    state.accountIndex++
    expect(state.accountIndex).toBe(1)
  })

  it('should increment antigravityEndpointIndex', () => {
    const state = createMockRetryState({ antigravityEndpointIndex: 0 })
    state.antigravityEndpointIndex++
    expect(state.antigravityEndpointIndex).toBe(1)
  })

  it('should set project ID', () => {
    const state = createMockRetryState()
    state.overrideProjectId = 'test-project-123'
    expect(state.overrideProjectId).toBe('test-project-123')
  })

  describe('createRetryState', () => {
    it('should create default retry state', () => {
      const state = createRetryState()
      expect(state.attempt).toBe(0)
      expect(state.accountIndex).toBe(-1)
      expect(state.antigravityEndpointIndex).toBe(0)
      expect(state.overrideProjectId).toBeNull()
      expect(state.maxRetryAttempts).toBe(40)
    })

    it('should allow custom maxRetryAttempts', () => {
      const state = createRetryState(5)
      expect(state.maxRetryAttempts).toBe(5)
    })
  })
})

describe('handleUpstreamError - Antigravity provider (System B)', () => {
  beforeEach(async () => {
    registerServerStrategies()
    // Note: registerLegacyProviderStrategies() is no longer needed
    mock.restore()
    spyOn(TokenRefresh, 'ensureFresh').mockResolvedValue([])
    spyOn(accountRotationManager, 'markRateLimited').mockImplementation(() => Promise.resolve())
    spyOn(accountRotationManager, 'areAllRateLimited').mockReturnValue(true)
    spyOn(accountRotationManager, 'hasNext').mockReturnValue(false)
  })

  describe('license error handling', () => {
    it('should fall back to default project on license error', async () => {
      const retryState = createMockRetryState()
      const ctx = createMockErrorContext({
        status: 403,
        errorText: 'PERMISSION_DENIED: license error #3501',
        currentProjectId: 'user-project-123',
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('retry')
      expect(retryState.overrideProjectId).toBe(ANTIGRAVITY_DEFAULT_PROJECT_ID)
    })

    it('should not fall back if already on default project', async () => {
      const retryState = createMockRetryState()
      const ctx = createMockErrorContext({
        status: 403,
        errorText: 'PERMISSION_DENIED: license error #3501',
        currentProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })

    it('should rotate endpoint if license error persists after fallback', async () => {
      const retryState = createMockRetryState({
        overrideProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
      })
      const ctx = createMockErrorContext({
        status: 403,
        errorText: 'PERMISSION_DENIED: license error #3501',
        currentProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })

    it('should throw if all endpoints exhausted for license error', async () => {
      const retryState = createMockRetryState({
        overrideProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
        antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1,
      })
      const ctx = createMockErrorContext({
        status: 403,
        errorText: 'PERMISSION_DENIED: license error #3501',
        currentProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      // AntigravityErrorStrategy returns null if exhausted, then Generic Rate Limit handler handles it
      // For non-429, generic handler returns 'throw'
      expect(result.action).toBe('throw')
    })
  })

  describe('403 error handling', () => {
    it('should retry generic 403 by falling back to default project', async () => {
      const retryState = createMockRetryState()
      const ctx = createMockErrorContext({
        status: 403,
        errorText: 'Forbidden',
        currentProjectId: 'user-project-456',
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('retry')
      expect(retryState.overrideProjectId).toBe(ANTIGRAVITY_DEFAULT_PROJECT_ID)
    })

    it('should not retry 403 if already on default project', async () => {
      const retryState = createMockRetryState()
      const ctx = createMockErrorContext({
        status: 403,
        errorText: 'Forbidden',
        currentProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('throw')
    })
  })

  describe('5xx server error handling', () => {
    it('should rotate endpoint on 500 error', async () => {
      const retryState = createMockRetryState()
      const ctx = createMockErrorContext({
        status: 500,
        errorText: 'Internal Server Error',
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })

    it('should rotate endpoint on 502 error', async () => {
      const retryState = createMockRetryState()
      const ctx = createMockErrorContext({
        status: 502,
        errorText: 'Bad Gateway',
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })

    it('should rotate endpoint on 503 error', async () => {
      const retryState = createMockRetryState()
      const ctx = createMockErrorContext({
        status: 503,
        errorText: 'Service Unavailable',
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })

    it('should throw if all endpoints exhausted on 5xx', async () => {
      const retryState = createMockRetryState({
        antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1,
      })
      const ctx = createMockErrorContext({
        status: 500,
        errorText: 'Internal Server Error',
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('throw')
    })
  })

  describe('429 rate limit handling', () => {
    beforeEach(() => {
      spyOn(TokenRefresh, 'ensureFresh').mockResolvedValue([
        { accessToken: 'token1', email: 'user1@test.com' },
        { accessToken: 'token2', email: 'user2@test.com' },
      ] as never)
      spyOn(accountRotationManager, 'markRateLimited').mockImplementation(() => Promise.resolve())
      spyOn(accountRotationManager, 'areAllRateLimited').mockReturnValue(false)
      spyOn(accountRotationManager, 'hasNext').mockReturnValue(true)
    })

    it('should rotate endpoint first on 429', async () => {
      const retryState = createMockRetryState()
      const ctx = createMockErrorContext({
        status: 429,
        errorText: 'Too Many Requests',
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })

    it('should mark account rate limited after endpoints exhausted', async () => {
      const markRateLimitedSpy = spyOn(accountRotationManager, 'markRateLimited').mockImplementation(() => Promise.resolve())
      const retryState = createMockRetryState({
        antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1,
      })
      const ctx = createMockErrorContext({
        status: 429,
        errorText: 'Too Many Requests',
        retryAfterMs: 60000,
        retryState,
      })

      await handleUpstreamError(ctx)

      expect(markRateLimitedSpy).toHaveBeenCalledWith(
        'antigravity',
        'gemini-2.5-pro',
        -1,
        60000,
        'Transient 429'
      )
    })

    it('should use default retry-after if not provided', async () => {
      const markRateLimitedSpy = spyOn(accountRotationManager, 'markRateLimited').mockImplementation(() => Promise.resolve())
      const retryState = createMockRetryState({
        antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1,
      })
      const ctx = createMockErrorContext({
        status: 429,
        errorText: 'Too Many Requests',
        retryState,
      })

      await handleUpstreamError(ctx)

      expect(markRateLimitedSpy).toHaveBeenCalledWith(
        'antigravity',
        'gemini-2.5-pro',
        -1,
        1,
        'Transient 429'
      )
    })

    it('should return retry when hasNext returns true (account rotation happens externally)', async () => {
      spyOn(accountRotationManager, 'hasNext').mockReturnValue(true)
      const retryState = createMockRetryState({
        antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1,
      })
      const ctx = createMockErrorContext({
        status: 429,
        errorText: 'Too Many Requests',
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('retry')
      // accountIndex is NOT incremented by handleUpstreamError itself
      // The calling code should call rotateAccount() if needed
      expect(retryState.accountIndex).toBe(-1)
    })

    it('should return all-cooldown when all accounts limited and no fallback', async () => {
      spyOn(accountRotationManager, 'areAllRateLimited').mockReturnValue(true)
      spyOn(accountRotationManager, 'hasNext').mockReturnValue(false)

      const retryState = createMockRetryState({
        antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1,
      })
      const ctx = createMockErrorContext({
        status: 429,
        errorText: 'Too Many Requests',
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('all-cooldown')
    })
  })

  describe('Opencode Zen error handling integration', () => {
    beforeEach(() => {
      registerServerStrategies()
    })

    it('should trigger switch-model on prompt_tokens error', async () => {
      const mockRouter = {
        handleRateLimit: mock(),
        resolveModel: mock().mockResolvedValue({
          provider: 'openai',
          model: 'gpt-4',
        }),
      } as unknown as Router

      const errorBody = JSON.stringify({
        error: { message: "Cannot read properties of undefined (reading 'prompt_tokens')" },
      })

      const retryState = createMockRetryState()
      const ctx = createMockErrorContext({
        provider: 'opencode-zen',
        model: 'big-pickle',
        status: 500,
        errorText: errorBody,
        router: mockRouter,
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('switch-model')
      expect(result.newProvider).toBe('openai')
      expect(mockRouter.handleRateLimit).toHaveBeenCalled()
    })
  })

  describe('Error result actions', () => {
    it('should return retry with delay for rate limit fallback', async () => {
      const retryState = createMockRetryState()
      const ctx = createMockErrorContext({
        status: 429,
        errorText: 'Too Many Requests',
        retryState,
      })

      const result = await handleUpstreamError(ctx)

      expect(result.action).toBe('retry')
      // Delay is undefined because hasNext returns true, implying immediate retry
      expect(result.delay).toBeUndefined()
    })
  })
})

describe('antigravityErrorStrategy (System B direct test)', () => {
  const strategy = new AntigravityErrorStrategy()

  beforeEach(() => {
    mock.restore()
  })

  describe('license error handling', () => {
    it('should set override project on license error', async () => {
      const retryState = createMockRetryState()
      const result = await strategy.handleError({
        provider: 'antigravity',
        model: 'gemini-2.5-pro',
        status: 403,
        errorText: 'PERMISSION_DENIED: license error #3501',
        currentProjectId: 'user-project',
        // @ts-ignore
        retryState
      })

      expect(result).not.toBeNull()
      expect(result!.action).toBe('retry')
      expect(retryState.overrideProjectId).toBe(ANTIGRAVITY_DEFAULT_PROJECT_ID)
    })

    it('should rotate endpoint on license error when already on default', async () => {
      const retryState = createMockRetryState({
        overrideProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
      })
      const result = await strategy.handleError({
        provider: 'antigravity',
        model: 'gemini-2.5-pro',
        status: 403,
        errorText: '#3501',
        currentProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
        // @ts-ignore
        retryState
      })

      expect(result).not.toBeNull()
      expect(result!.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })
  })

  describe('403 error handling', () => {
    it('should retry non-license 403 (fallback to default project)', async () => {
      const retryState = createMockRetryState()
      const result = await strategy.handleError({
        provider: 'antigravity',
        model: 'gemini-2.5-pro',
        status: 403,
        errorText: 'Forbidden',
        currentProjectId: 'user-project',
        // @ts-ignore
        retryState
      })

      expect(result).not.toBeNull()
      expect(result!.action).toBe('retry')
      expect(retryState.overrideProjectId).toBe(ANTIGRAVITY_DEFAULT_PROJECT_ID)
    })
  })

  describe('5xx error handling', () => {
    it('should rotate endpoint on 500', async () => {
      const retryState = createMockRetryState()
      const result = await strategy.handleError({
        provider: 'antigravity',
        model: 'gemini-2.5-pro',
        status: 500,
        errorText: 'Internal Server Error',
        // @ts-ignore
        retryState
      })

      expect(result).not.toBeNull()
      expect(result!.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })

    it('should return null when all endpoints exhausted', async () => {
      const retryState = createMockRetryState({
        antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1,
      })
      const result = await strategy.handleError({
        provider: 'antigravity',
        model: 'gemini-2.5-pro',
        status: 500,
        errorText: 'Internal Server Error',
        // @ts-ignore
        retryState
      })

      expect(result).toBeNull()
    })
  })

  describe('429 rate limit handling', () => {
    it('should rotate endpoint on 429', async () => {
      const retryState = createMockRetryState()
      const result = await strategy.handleError({
        provider: 'antigravity',
        model: 'gemini-2.5-pro',
        status: 429,
        errorText: 'Too Many Requests',
        // @ts-ignore
        retryState
      })

      expect(result).not.toBeNull()
      expect(result!.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })

    it('should return null when all endpoints exhausted on 429', async () => {
      const retryState = createMockRetryState({
        antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1,
      })
      const result = await strategy.handleError({
        provider: 'antigravity',
        model: 'gemini-2.5-pro',
        status: 429,
        errorText: 'Too Many Requests',
        // @ts-ignore
        retryState
      })

      expect(result).toBeNull()
    })
  })
})

describe('AccountRotationManager integration', () => {
  beforeEach(async () => {
    mock.restore()
    // Add dummy credentials to prevent TokenRefresh from throwing
    await CredentialStorage.add('antigravity', {
      type: 'oauth',
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: Date.now() + 3600000,
    })
  })

  describe('rate limit tracking', () => {
    it('should track rate limited accounts', async () => {
      await accountRotationManager.markRateLimited('antigravity', 'test-model', 0, 60000)

      const credentials = [
        { type: 'oauth', accessToken: 'token1', email: 'user1@test.com' },
        { type: 'oauth', accessToken: 'token2', email: 'user2@test.com' },
      ] as never[]

      const allLimited = accountRotationManager.areAllRateLimited('antigravity', 'test-model', credentials)
      expect(allLimited).toBe(false)
    })

    it('should detect when all accounts are rate limited', () => {
      const credentials = [
        { type: 'oauth', accessToken: 'token1', email: 'user1@test.com' },
      ] as never[]

      // Mock getAccountId to return a predictable ID
      spyOn(accountRotationManager as any, 'getAccountId').mockReturnValue('user1@test.com')

      rateLimitStore.markLimit('antigravity', 'user1@test.com', 'gemini-pro', {
        expiresAt: Date.now() + 60000,
      })

      const allLimited = accountRotationManager.areAllRateLimited('antigravity', 'gemini-2.5-pro', credentials)
      expect(allLimited).toBe(true)
    })
  })

  describe('account selection', () => {
    it('should return next available account', () => {
      const credentials = [
        { type: 'oauth', accessToken: 'token1', email: 'user1@test.com' },
        { type: 'oauth', accessToken: 'token2', email: 'user2@test.com' },
      ] as never[]

      spyOn(accountRotationManager as any, 'getAccountId').mockImplementation((cred: any) => cred.email)

      // Mark user1 as limited
      rateLimitStore.markLimit('antigravity', 'user1@test.com', 'gemini-pro', {
        expiresAt: Date.now() + 60000,
      })

      const next = accountRotationManager.hasNext('antigravity', 'gemini-2.5-pro', 0, credentials)
      expect(next).toBe(true)
    })
  })
})
