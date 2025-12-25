import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { TokenRefresh } from '../src/refresh'
import { CredentialStorage } from '../src/storage'
import { AuthProviderRegistry } from '../src/providers/registry'
import type { OAuthCredential, ApiKeyCredential, Credential } from '../src/types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('TokenRefresh', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmux-refresh-test-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('isExpired', () => {
    test('returns true for expired credential', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 1000,
      }
      expect(TokenRefresh.isExpired(credential)).toBe(true)
    })

    test('returns false for valid credential', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 60 * 60 * 1000,
      }
      expect(TokenRefresh.isExpired(credential)).toBe(false)
    })
  })

  describe('shouldRefresh', () => {
    test('returns true when within buffer window', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 2 * 60 * 1000, // 2 minutes
      }
      // Default buffer is 5 minutes
      expect(TokenRefresh.shouldRefresh(credential)).toBe(true)
    })

    test('returns false when outside buffer window', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      }
      expect(TokenRefresh.shouldRefresh(credential)).toBe(false)
    })

    test('respects custom buffer time', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 30 * 1000, // 30 seconds
      }
      // 20 seconds buffer - expires in 30s, buffer 20s means we still have 10s margin, so no refresh
      expect(TokenRefresh.shouldRefresh(credential, 20 * 1000)).toBe(false)
      // 60 seconds buffer - expires in 30s, buffer 60s means we're already within the window
      expect(TokenRefresh.shouldRefresh(credential, 60 * 1000)).toBe(true)
    })
  })

  describe('ensureFresh', () => {
    test('throws when no credentials found', async () => {
      await expect(TokenRefresh.ensureFresh('nonexistent-provider')).rejects.toThrow(
        'No credentials found'
      )
    })

    test('returns API key credentials as-is', async () => {
      const apiKey: ApiKeyCredential = { type: 'api', key: 'test-key' }
      await CredentialStorage.add('openai', apiKey)

      const result = await TokenRefresh.ensureFresh('openai')
      expect(result).toEqual([apiKey])
    })

    test('returns non-expired OAuth credentials as-is', async () => {
      const oauth: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
      }
      await CredentialStorage.add('antigravity', oauth)

      const result = await TokenRefresh.ensureFresh('antigravity')
      expect(result).toEqual([oauth])
    })

    test('keeps credential if no refresh function available', async () => {
      const expiringSoon: OAuthCredential = {
        type: 'oauth',
        accessToken: 'old-token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 60 * 1000, // 1 minute (within 5min buffer)
      }
      await CredentialStorage.add('no-refresh-provider', expiringSoon)

      const result = await TokenRefresh.ensureFresh('no-refresh-provider')
      expect(result).toEqual([expiringSoon])
    })

    test('handles mixed credential types', async () => {
      const apiKey: ApiKeyCredential = { type: 'api', key: 'key' }
      const oauth: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 60 * 60 * 1000,
      }

      await CredentialStorage.add('mixed', apiKey)
      await CredentialStorage.add('mixed', oauth)

      const result = await TokenRefresh.ensureFresh('mixed')
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(apiKey)
      expect(result).toContainEqual(oauth)
    })
  })

  describe('OAuth refresh flow', () => {
    test('calls provider refresh when token needs refresh', async () => {
      const expiringSoon: OAuthCredential = {
        type: 'oauth',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: Date.now() + 60 * 1000, // 1 minute
        email: 'user@example.com',
      }

      const refreshedToken: OAuthCredential = {
        type: 'oauth',
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        expiresAt: Date.now() + 60 * 60 * 1000,
        email: 'user@example.com',
      }

      const mockRefresh = mock(async (_cred: OAuthCredential) => refreshedToken)

      const mockProvider = {
        id: 'mock-provider',
        name: 'Mock Provider',
        methods: [],
        getCredential: async () => undefined,
        getHeaders: async () => ({}),
        getEndpoint: () => 'https://api.mock.com',
        refresh: mockRefresh,
      }

      AuthProviderRegistry.register(mockProvider)
      await CredentialStorage.add('mock-provider', expiringSoon)

      const result = await TokenRefresh.ensureFresh('mock-provider')

      expect(mockRefresh).toHaveBeenCalledTimes(1)
      expect(result[0]).toEqual(refreshedToken)

      AuthProviderRegistry.unregister?.('mock-provider')
    })

    test('keeps old credential if refresh fails', async () => {
      const expiringSoon: OAuthCredential = {
        type: 'oauth',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: Date.now() + 60 * 1000,
        email: 'user@example.com',
      }

      const mockRefresh = mock(async () => {
        throw new Error('Refresh failed')
      })

      const mockProvider = {
        id: 'failing-provider',
        name: 'Failing Provider',
        methods: [],
        getCredential: async () => undefined,
        getHeaders: async () => ({}),
        getEndpoint: () => 'https://api.failing.com',
        refresh: mockRefresh,
      }

      AuthProviderRegistry.register(mockProvider)
      await CredentialStorage.add('failing-provider', expiringSoon)

      const result = await TokenRefresh.ensureFresh('failing-provider')

      expect(result[0]).toEqual(expiringSoon)

      AuthProviderRegistry.unregister?.('failing-provider')
    })

    test('refreshes multiple expiring credentials', async () => {
      const expiring1: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token1',
        refreshToken: 'refresh1',
        expiresAt: Date.now() + 60 * 1000,
        email: 'user1@example.com',
      }

      const expiring2: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token2',
        refreshToken: 'refresh2',
        expiresAt: Date.now() + 60 * 1000,
        email: 'user2@example.com',
      }

      let callCount = 0
      const mockRefresh = mock(async (cred: OAuthCredential): Promise<OAuthCredential> => {
        callCount++
        return {
          ...cred,
          accessToken: `refreshed-${callCount}`,
          expiresAt: Date.now() + 60 * 60 * 1000,
        }
      })

      const mockProvider = {
        id: 'multi-provider',
        name: 'Multi Provider',
        methods: [],
        getCredential: async () => undefined,
        getHeaders: async () => ({}),
        getEndpoint: () => 'https://api.multi.com',
        refresh: mockRefresh,
      }

      AuthProviderRegistry.register(mockProvider)
      await CredentialStorage.add('multi-provider', expiring1)
      await CredentialStorage.add('multi-provider', expiring2)

      const result = await TokenRefresh.ensureFresh('multi-provider')

      expect(mockRefresh).toHaveBeenCalledTimes(2)
      expect(result).toHaveLength(2)
      expect(result[0]?.accessToken).toBe('refreshed-1')
      expect(result[1]?.accessToken).toBe('refreshed-2')

      AuthProviderRegistry.unregister?.('multi-provider')
    })
  })
})
