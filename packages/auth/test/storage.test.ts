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

  test('get returns undefined when no credentials exist', async () => {
    const credential = await CredentialStorage.get('opencode-zen')
    expect(credential).toBeUndefined()
  })

  test('set and get API key credential', async () => {
    const apiKey: ApiKeyCredential = {
      type: 'api',
      key: 'sk-test-key-12345',
    }
    await CredentialStorage.set('opencode-zen', apiKey)
    const retrieved = await CredentialStorage.get('opencode-zen')
    expect(retrieved).toEqual(apiKey)
  })

  test('set and get OAuth credential', async () => {
    const oauth: OAuthCredential = {
      type: 'oauth',
      accessToken: 'access_token_123',
      refreshToken: 'refresh_token_456',
      expiresAt: 1700000000000,
      email: 'test@example.com',
    }
    await CredentialStorage.set('github-copilot', oauth)
    const retrieved = await CredentialStorage.get('github-copilot')
    expect(retrieved).toEqual(oauth)
  })

  test('remove credential', async () => {
    const apiKey: ApiKeyCredential = { type: 'api', key: 'test-key' }
    await CredentialStorage.set('test-provider', apiKey)
    expect(await CredentialStorage.get('test-provider')).toEqual(apiKey)

    await CredentialStorage.remove('test-provider')
    expect(await CredentialStorage.get('test-provider')).toBeUndefined()
  })

  test('remove non-existent credential does not throw', async () => {
    await CredentialStorage.remove('non-existent')
  })

  test('all returns empty object when no credentials', async () => {
    const all = await CredentialStorage.all()
    expect(all).toEqual({})
  })

  test('all returns all stored credentials', async () => {
    const apiKey: ApiKeyCredential = { type: 'api', key: 'key1' }
    const oauth: OAuthCredential = {
      type: 'oauth',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 1700000000000,
    }

    await CredentialStorage.set('provider1', apiKey)
    await CredentialStorage.set('provider2', oauth)

    const all = await CredentialStorage.all()
    expect(all).toEqual({
      provider1: apiKey,
      provider2: oauth,
    })
  })

  test('set overwrites existing credential', async () => {
    const key1: ApiKeyCredential = { type: 'api', key: 'first-key' }
    const key2: ApiKeyCredential = { type: 'api', key: 'second-key' }

    await CredentialStorage.set('provider', key1)
    await CredentialStorage.set('provider', key2)

    const retrieved = await CredentialStorage.get('provider')
    expect(retrieved).toEqual(key2)
  })
})
