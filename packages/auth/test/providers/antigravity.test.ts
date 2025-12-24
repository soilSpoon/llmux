import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { AntigravityProvider } from '../../src/providers/antigravity'
import { CredentialStorage } from '../../src/storage'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('AntigravityProvider', () => {
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

  test('has correct id and name', () => {
    expect(AntigravityProvider.id).toBe('antigravity')
    expect(AntigravityProvider.name).toBe('Antigravity (Gemini)')
  })

  test('supports api key method', () => {
    const apiMethod = AntigravityProvider.methods.find(m => m.type === 'api')
    expect(apiMethod).toBeDefined()
    expect(apiMethod?.label).toBe('API Key')
  })

  test('getCredential returns undefined when no credential stored', async () => {
    const credential = await AntigravityProvider.getCredential()
    expect(credential).toBeUndefined()
  })

  test('getCredential returns stored credential', async () => {
    await CredentialStorage.set('antigravity', { type: 'api', key: 'test-key' })
    const credential = await AntigravityProvider.getCredential()
    expect(credential).toEqual({ type: 'api', key: 'test-key' })
  })

  test('getHeaders returns x-goog-api-key header for API key', async () => {
    await CredentialStorage.set('antigravity', { type: 'api', key: 'AIza-test-key' })
    const headers = await AntigravityProvider.getHeaders()
    expect(headers['x-goog-api-key']).toBe('AIza-test-key')
    expect(headers['Content-Type']).toBe('application/json')
  })

  test('getHeaders returns Authorization for OAuth credential', async () => {
    const oauth = {
      type: 'oauth' as const,
      accessToken: 'ya29.test_token',
      refreshToken: 'refresh_test',
      expiresAt: Date.now() + 3600000,
      projectId: 'my-project',
    }
    await CredentialStorage.set('antigravity', oauth)
    const headers = await AntigravityProvider.getHeaders()
    expect(headers['Authorization']).toBe('Bearer ya29.test_token')
    expect(headers['Content-Type']).toBe('application/json')
  })

  test('getHeaders returns empty when no credential', async () => {
    const headers = await AntigravityProvider.getHeaders()
    expect(headers).toEqual({})
  })

  test('getEndpoint returns correct Gemini URL with model', () => {
    const endpoint = AntigravityProvider.getEndpoint('gemini-2.0-flash')
    expect(endpoint).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent')
  })

  test('getEndpoint handles different model names', () => {
    expect(AntigravityProvider.getEndpoint('gemini-pro')).toContain('gemini-pro:generateContent')
    expect(AntigravityProvider.getEndpoint('gemini-1.5-pro')).toContain('gemini-1.5-pro:generateContent')
  })

  test('authorize with api key stores credential', async () => {
    const apiMethod = AntigravityProvider.methods.find(m => m.type === 'api')!
    const result = await apiMethod.authorize({ key: 'AIza-new-key' })
    expect(result.type).toBe('success')
    expect(result.credential).toEqual({ type: 'api', key: 'AIza-new-key' })

    const stored = await CredentialStorage.get('antigravity')
    expect(stored).toEqual({ type: 'api', key: 'AIza-new-key' })
  })

  test('authorize fails when no key provided', async () => {
    const apiMethod = AntigravityProvider.methods.find(m => m.type === 'api')!
    const result = await apiMethod.authorize({})
    expect(result.type).toBe('failed')
    expect(result.error).toBeDefined()
  })
})
