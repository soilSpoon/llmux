import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { ANTIGRAVITY_ENDPOINT_FALLBACKS, TokenRefresh } from '@llmux/auth'
import { accountRotationManager } from '../account-rotation'
import { rateLimitStore } from '../rate-limit-store'
import {
  createRetryState,
  handleUpstreamError,
  rotateAccount,
  rotateAntigravityEndpoint,
  setOverrideProjectId,
  type ErrorHandlingContext,
  type RetryState,
} from '../request-handler'
import { AntigravityStrategy } from '../providers/antigravity-strategy'
import { GeminiCliStrategy } from '../providers/gemini-cli-strategy'
import { ANTIGRAVITY_DEFAULT_PROJECT_ID } from '../../providers/antigravity'

function createMockRetryState(overrides: Partial<RetryState> = {}): RetryState {
  return {
    attempt: 0,
    accountIndex: -1,
    antigravityEndpointIndex: 0,
    overrideProjectId: null,
    maxRetryAttempts: 20,
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
  describe('rotateAccount', () => {
    it('should increment accountIndex', () => {
      const state = createMockRetryState({ accountIndex: 0 })
      rotateAccount(state)
      expect(state.accountIndex).toBe(1)
    })

    it('should increment from any value', () => {
      const state = createMockRetryState({ accountIndex: 5 })
      rotateAccount(state)
      expect(state.accountIndex).toBe(6)
    })
  })

  describe('rotateAntigravityEndpoint', () => {
    it('should increment antigravityEndpointIndex', () => {
      const state = createMockRetryState({ antigravityEndpointIndex: 0 })
      rotateAntigravityEndpoint(state)
      expect(state.antigravityEndpointIndex).toBe(1)
    })

    it('should increment from any value', () => {
      const state = createMockRetryState({ antigravityEndpointIndex: 2 })
      rotateAntigravityEndpoint(state)
      expect(state.antigravityEndpointIndex).toBe(3)
    })
  })

  describe('setOverrideProjectId', () => {
    it('should set project ID', () => {
      const state = createMockRetryState()
      setOverrideProjectId(state, 'test-project-123')
      expect(state.overrideProjectId).toBe('test-project-123')
    })

    it('should overwrite existing project ID', () => {
      const state = createMockRetryState({ overrideProjectId: 'old-project' })
      setOverrideProjectId(state, 'new-project')
      expect(state.overrideProjectId).toBe('new-project')
    })
  })

  describe('createRetryState', () => {
    it('should create default retry state', () => {
      const state = createRetryState()
      expect(state.attempt).toBe(0)
      expect(state.accountIndex).toBe(-1)
      expect(state.antigravityEndpointIndex).toBe(0)
      expect(state.overrideProjectId).toBeNull()
      expect(state.maxRetryAttempts).toBe(20)
    })

    it('should allow custom maxRetryAttempts', () => {
      const state = createRetryState(5)
      expect(state.maxRetryAttempts).toBe(5)
    })
  })
})

describe('handleUpstreamError - Antigravity provider', () => {
  beforeEach(() => {
    // Reset any mocks
    mock.restore()
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

      expect(result.action).toBe('throw')
    })
  })

  describe('403 error handling', () => {
    it('should try default project before rotation on 403', async () => {
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
        'soft',
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
        30000,
        'soft',
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
})

describe('handleUpstreamError - Error result actions', () => {
  it('should return throw for non-retryable errors', async () => {
    const retryState = createMockRetryState()
    const ctx = createMockErrorContext({
      provider: 'openai',
      status: 400,
      errorText: 'Bad Request',
      retryState,
    })

    const result = await handleUpstreamError(ctx)

    expect(result.action).toBe('throw')
  })

  it('should return throw for 401 unauthorized', async () => {
    const retryState = createMockRetryState()
    const ctx = createMockErrorContext({
      provider: 'openai',
      status: 401,
      errorText: 'Unauthorized',
      retryState,
    })

    const result = await handleUpstreamError(ctx)

    expect(result.action).toBe('throw')
  })

  it('should return retry with delay for rate limit fallback', async () => {
    spyOn(TokenRefresh, 'ensureFresh').mockResolvedValue([
      { accessToken: 'token1', email: 'user1@test.com' },
    ] as never)
    spyOn(accountRotationManager, 'markRateLimited').mockImplementation(() => Promise.resolve())
    spyOn(accountRotationManager, 'areAllRateLimited').mockReturnValue(false)
    spyOn(accountRotationManager, 'hasNext').mockReturnValue(false)

    const retryState = createMockRetryState({
      antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length,
    })
    const ctx = createMockErrorContext({
      status: 429,
      errorText: 'Too Many Requests',
      retryState,
    })

    const result = await handleUpstreamError(ctx)

    expect(result.action).toBe('retry')
    expect(result.delay).toBe(1000)
  })
})

describe('AntigravityStrategy.handleError', () => {
  const strategy = new AntigravityStrategy()

  describe('license error handling', () => {
    it('should set override project on license error', async () => {
      const retryState = createMockRetryState()
      const result = await strategy.handleError(
        {
          reqId: 'test',
          provider: 'antigravity',
          model: 'gemini-2.5-pro',
          status: 403,
          errorText: 'PERMISSION_DENIED: license error #3501',
          currentProjectId: 'user-project',
        },
        retryState
      )

      expect(result).not.toBeNull()
      expect(result!.action).toBe('retry')
      expect(retryState.overrideProjectId).toBe(ANTIGRAVITY_DEFAULT_PROJECT_ID)
    })

    it('should rotate endpoint on license error when already on default', async () => {
      const retryState = createMockRetryState({
        overrideProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
      })
      const result = await strategy.handleError(
        {
          reqId: 'test',
          provider: 'antigravity',
          model: 'gemini-2.5-pro',
          status: 403,
          errorText: '#3501',
          currentProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
        },
        retryState
      )

      expect(result).not.toBeNull()
      expect(result!.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })
  })

  describe('403 error handling', () => {
    it('should set override project on unexpected 403', async () => {
      const retryState = createMockRetryState()
      const result = await strategy.handleError(
        {
          reqId: 'test',
          provider: 'antigravity',
          model: 'gemini-2.5-pro',
          status: 403,
          errorText: 'Forbidden',
          currentProjectId: 'user-project',
        },
        retryState
      )

      expect(result).not.toBeNull()
      expect(result!.action).toBe('retry')
      expect(retryState.overrideProjectId).toBe(ANTIGRAVITY_DEFAULT_PROJECT_ID)
    })
  })

  describe('5xx error handling', () => {
    it('should rotate endpoint on 500', async () => {
      const retryState = createMockRetryState()
      const result = await strategy.handleError(
        {
          reqId: 'test',
          provider: 'antigravity',
          model: 'gemini-2.5-pro',
          status: 500,
          errorText: 'Internal Server Error',
        },
        retryState
      )

      expect(result).not.toBeNull()
      expect(result!.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })

    it('should return null when all endpoints exhausted', async () => {
      const retryState = createMockRetryState({
        antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1,
      })
      const result = await strategy.handleError(
        {
          reqId: 'test',
          provider: 'antigravity',
          model: 'gemini-2.5-pro',
          status: 500,
          errorText: 'Internal Server Error',
        },
        retryState
      )

      expect(result).toBeNull()
    })
  })

  describe('429 rate limit handling', () => {
    it('should rotate endpoint on 429', async () => {
      const retryState = createMockRetryState()
      const result = await strategy.handleError(
        {
          reqId: 'test',
          provider: 'antigravity',
          model: 'gemini-2.5-pro',
          status: 429,
          errorText: 'Too Many Requests',
        },
        retryState
      )

      expect(result).not.toBeNull()
      expect(result!.action).toBe('retry')
      expect(retryState.antigravityEndpointIndex).toBe(1)
    })

    it('should return null when all endpoints exhausted on 429', async () => {
      const retryState = createMockRetryState({
        antigravityEndpointIndex: ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1,
      })
      const result = await strategy.handleError(
        {
          reqId: 'test',
          provider: 'antigravity',
          model: 'gemini-2.5-pro',
          status: 429,
          errorText: 'Too Many Requests',
        },
        retryState
      )

      expect(result).toBeNull()
    })
  })
})

describe('GeminiCliStrategy.handleError', () => {
  const strategy = new GeminiCliStrategy()

  it('should delegate to AntigravityStrategy', async () => {
    const retryState = createMockRetryState()
    const result = await strategy.handleError(
      {
        reqId: 'test',
        provider: 'gemini-cli',
        model: 'gemini-2.5-pro',
        status: 500,
        errorText: 'Internal Server Error',
      },
      retryState
    )

    expect(result).not.toBeNull()
    expect(result!.action).toBe('retry')
    expect(retryState.antigravityEndpointIndex).toBe(1)
  })

  it('should handle 403 same as Antigravity', async () => {
    const retryState = createMockRetryState()
    const result = await strategy.handleError(
      {
        reqId: 'test',
        provider: 'gemini-cli',
        model: 'gemini-2.5-pro',
        status: 403,
        errorText: 'Forbidden',
        currentProjectId: 'user-project',
      },
      retryState
    )

    expect(result).not.toBeNull()
    expect(result!.action).toBe('retry')
    expect(retryState.overrideProjectId).toBe(ANTIGRAVITY_DEFAULT_PROJECT_ID)
  })

  it('should handle 429 same as Antigravity', async () => {
    const retryState = createMockRetryState()
    const result = await strategy.handleError(
      {
        reqId: 'test',
        provider: 'gemini-cli',
        model: 'gemini-2.5-pro',
        status: 429,
        errorText: 'Too Many Requests',
      },
      retryState
    )

    expect(result).not.toBeNull()
    expect(result!.action).toBe('retry')
    expect(retryState.antigravityEndpointIndex).toBe(1)
  })
})

describe('AccountRotationManager integration', () => {
  beforeEach(() => {
    mock.restore()
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
        type: 'soft',
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

      const nextIndex = accountRotationManager.getNextAvailable('antigravity', 'test-model-3', credentials)
      expect(nextIndex).toBe(0)
    })

    it('should skip rate limited accounts', () => {
      const credentials = [
        { type: 'oauth', accessToken: 'token1', email: 'user1@test.com' },
        { type: 'oauth', accessToken: 'token2', email: 'user2@test.com' },
      ] as never[]

      // Mock getAccountId
      const getAccountIdSpy = spyOn(accountRotationManager as any, 'getAccountId')
      getAccountIdSpy.mockImplementation((cred: any) => cred.email)

      rateLimitStore.markLimit('antigravity', 'user1@test.com', 'gemini-pro', {
        type: 'soft',
        expiresAt: Date.now() + 60000,
      })

      const nextIndex = accountRotationManager.getNextAvailable('antigravity', 'gemini-2.5-pro', credentials)
      expect(nextIndex).toBe(1)
    })
  })
})
