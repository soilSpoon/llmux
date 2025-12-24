import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { TokenRefresh } from '../src/refresh'
import { CredentialStorage } from '../src/storage'
import type { OAuthCredential, ApiKeyCredential } from '../src/types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('TokenRefresh', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmux-auth-test-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('isExpired', () => {
    test('returns true for expired token', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 1000,
      }
      expect(TokenRefresh.isExpired(credential)).toBe(true)
    })

    test('returns false for valid token', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
      }
      expect(TokenRefresh.isExpired(credential)).toBe(false)
    })
  })

  describe('shouldRefresh', () => {
    test('returns true when token expires within buffer', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 60000,
      }
      expect(TokenRefresh.shouldRefresh(credential, 300000)).toBe(true)
    })

    test('returns false when token has sufficient time', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
      }
      expect(TokenRefresh.shouldRefresh(credential, 300000)).toBe(false)
    })

    test('uses default buffer of 5 minutes', () => {
      const expiresInThreeMinutes: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 180000,
      }
      expect(TokenRefresh.shouldRefresh(expiresInThreeMinutes)).toBe(true)

      const expiresInTenMinutes: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 600000,
      }
      expect(TokenRefresh.shouldRefresh(expiresInTenMinutes)).toBe(false)
    })
  })

  describe('ensureFresh', () => {
    test('returns API key credential as-is', async () => {
      const apiKey: ApiKeyCredential = { type: 'api', key: 'test-key' }
      await CredentialStorage.set('test-provider', apiKey)

      const result = await TokenRefresh.ensureFresh('test-provider')
      expect(result).toEqual(apiKey)
    })

    test('throws when no credential exists', async () => {
      await expect(TokenRefresh.ensureFresh('unknown')).rejects.toThrow()
    })

    test('returns valid OAuth credential as-is', async () => {
      const oauth: OAuthCredential = {
        type: 'oauth',
        accessToken: 'valid-token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
      }
      await CredentialStorage.set('test-provider', oauth)

      const result = await TokenRefresh.ensureFresh('test-provider')
      expect(result).toEqual(oauth)
    })
  })
})
