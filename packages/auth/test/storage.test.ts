import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { CredentialStorage } from '../src/storage'
import type { OAuthCredential, ApiKeyCredential } from '../src/types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('CredentialStorage', () => {
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

  test('getPath returns correct path', () => {
    const path = CredentialStorage.getPath()
    expect(path).toBe(join(tempDir, '.llmux', 'credentials.json'))
  })

  test('get returns empty array when no credentials exist', async () => {
    const credentials = await CredentialStorage.get('opencode-zen')
    expect(credentials).toEqual([])
  })

  test('add and get API key credential', async () => {
    const apiKey: ApiKeyCredential = {
      type: 'api',
      key: 'sk-test-key-12345',
    }
    await CredentialStorage.add('opencode-zen', apiKey)
    const retrieved = await CredentialStorage.get('opencode-zen')
    expect(retrieved).toEqual([apiKey])
  })

  test('add and get OAuth credential', async () => {
    const oauth: OAuthCredential = {
      type: 'oauth',
      accessToken: 'access_token_123',
      refreshToken: 'refresh_token_456',
      expiresAt: 1700000000000,
      email: 'test@example.com',
    }
    await CredentialStorage.add('github-copilot', oauth)
    const retrieved = await CredentialStorage.get('github-copilot')
    expect(retrieved).toEqual([oauth])
  })

  test('remove credential', async () => {
    const apiKey: ApiKeyCredential = { type: 'api', key: 'test-key' }
    await CredentialStorage.add('test-provider', apiKey)
    expect(await CredentialStorage.get('test-provider')).toEqual([apiKey])

    await CredentialStorage.remove('test-provider')
    expect(await CredentialStorage.get('test-provider')).toEqual([])
  })

  test('remove non-existent credential does not throw', async () => {
    await CredentialStorage.remove('non-existent')
  })

  test('all returns empty object when no credentials', async () => {
    const all = await CredentialStorage.all()
    expect(all).toEqual({})
  })

  test('all returns all stored credentials as arrays', async () => {
    const apiKey: ApiKeyCredential = { type: 'api', key: 'key1' }
    const oauth: OAuthCredential = {
      type: 'oauth',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 1700000000000,
    }

    await CredentialStorage.add('provider1', apiKey)
    await CredentialStorage.add('provider2', oauth)

    const all = await CredentialStorage.all()
    expect(all).toEqual({
      provider1: [apiKey],
      provider2: [oauth],
    })
  })

  describe('multi-credential support', () => {
    test('add multiple API keys for same provider', async () => {
      const key1: ApiKeyCredential = { type: 'api', key: 'first-key' }
      const key2: ApiKeyCredential = { type: 'api', key: 'second-key' }

      await CredentialStorage.add('openai', key1)
      await CredentialStorage.add('openai', key2)

      const retrieved = await CredentialStorage.get('openai')
      expect(retrieved).toHaveLength(2)
      expect(retrieved).toContainEqual(key1)
      expect(retrieved).toContainEqual(key2)
    })

    test('add multiple OAuth credentials for same provider', async () => {
      const oauth1: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token1',
        refreshToken: 'refresh1',
        expiresAt: 1700000000000,
        email: 'user1@example.com',
      }
      const oauth2: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token2',
        refreshToken: 'refresh2',
        expiresAt: 1700000000000,
        email: 'user2@example.com',
      }

      await CredentialStorage.add('antigravity', oauth1)
      await CredentialStorage.add('antigravity', oauth2)

      const retrieved = await CredentialStorage.get('antigravity')
      expect(retrieved).toHaveLength(2)
      expect(retrieved).toContainEqual(oauth1)
      expect(retrieved).toContainEqual(oauth2)
    })

    test('update existing credential by matching key', async () => {
      const key1: ApiKeyCredential = { type: 'api', key: 'same-key' }
      const key1Updated: ApiKeyCredential = { type: 'api', key: 'same-key' }

      await CredentialStorage.add('openai', key1)
      await CredentialStorage.add('openai', key1Updated)

      const retrieved = await CredentialStorage.get('openai')
      expect(retrieved).toHaveLength(1)
      expect(retrieved[0]).toEqual(key1Updated)
    })

    test('update existing OAuth credential by matching email', async () => {
      const oauth1: OAuthCredential = {
        type: 'oauth',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: 1700000000000,
        email: 'user@example.com',
      }
      const oauth1Updated: OAuthCredential = {
        type: 'oauth',
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        expiresAt: 1800000000000,
        email: 'user@example.com',
      }

      await CredentialStorage.add('antigravity', oauth1)
      await CredentialStorage.add('antigravity', oauth1Updated)

      const retrieved = await CredentialStorage.get('antigravity')
      expect(retrieved).toHaveLength(1)
      expect(retrieved[0]).toEqual(oauth1Updated)
    })

    test('mixed credential types for same provider', async () => {
      const apiKey: ApiKeyCredential = { type: 'api', key: 'my-key' }
      const oauth: OAuthCredential = {
        type: 'oauth',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: 1700000000000,
        email: 'user@example.com',
      }

      await CredentialStorage.add('hybrid-provider', apiKey)
      await CredentialStorage.add('hybrid-provider', oauth)

      const retrieved = await CredentialStorage.get('hybrid-provider')
      expect(retrieved).toHaveLength(2)
      expect(retrieved).toContainEqual(apiKey)
      expect(retrieved).toContainEqual(oauth)
    })

    test('update function works same as add', async () => {
      const key1: ApiKeyCredential = { type: 'api', key: 'key1' }
      const key2: ApiKeyCredential = { type: 'api', key: 'key2' }

      await CredentialStorage.add('provider', key1)
      await CredentialStorage.update('provider', key2)

      const retrieved = await CredentialStorage.get('provider')
      expect(retrieved).toHaveLength(2)
    })

    test('set function works same as add', async () => {
      const key1: ApiKeyCredential = { type: 'api', key: 'key1' }
      const key2: ApiKeyCredential = { type: 'api', key: 'key2' }

      await CredentialStorage.set('provider', key1)
      await CredentialStorage.set('provider', key2)

      const retrieved = await CredentialStorage.get('provider')
      expect(retrieved).toHaveLength(2)
    })
  })
})
