import { describe, expect, test } from 'bun:test'
import {
  type AuthType,
  type ProviderID,
  type OAuthCredential,
  type ApiKeyCredential,
  type Credential,
  isOAuthCredential,
  isApiKeyCredential,
} from '../src/types'

describe('types', () => {
  describe('type guards', () => {
    test('isOAuthCredential returns true for OAuth credentials', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'access_123',
        refreshToken: 'refresh_456',
        expiresAt: Date.now() + 3600000,
      }
      expect(isOAuthCredential(credential)).toBe(true)
      expect(isApiKeyCredential(credential)).toBe(false)
    })

    test('isOAuthCredential handles optional fields', () => {
      const credential: OAuthCredential = {
        type: 'oauth',
        accessToken: 'access_123',
        refreshToken: 'refresh_456',
        expiresAt: Date.now() + 3600000,
        projectId: 'proj_123',
        email: 'user@example.com',
      }
      expect(isOAuthCredential(credential)).toBe(true)
    })

    test('isApiKeyCredential returns true for API key credentials', () => {
      const credential: ApiKeyCredential = {
        type: 'api',
        key: 'sk-1234567890',
      }
      expect(isApiKeyCredential(credential)).toBe(true)
      expect(isOAuthCredential(credential)).toBe(false)
    })

    test('type guards handle undefined/null', () => {
      expect(isOAuthCredential(undefined as unknown as Credential)).toBe(false)
      expect(isOAuthCredential(null as unknown as Credential)).toBe(false)
      expect(isApiKeyCredential(undefined as unknown as Credential)).toBe(false)
      expect(isApiKeyCredential(null as unknown as Credential)).toBe(false)
    })

    test('type guards handle invalid objects', () => {
      expect(isOAuthCredential({} as Credential)).toBe(false)
      expect(isApiKeyCredential({} as Credential)).toBe(false)
      expect(isOAuthCredential({ type: 'unknown' } as Credential)).toBe(false)
    })
  })
})
