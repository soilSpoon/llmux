import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { OpencodeZenProvider } from '../../src/providers/opencode-zen'
import { CredentialStorage } from '../../src/storage'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('OpencodeZenProvider', () => {
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
    expect(OpencodeZenProvider.id).toBe('opencode-zen')
    expect(OpencodeZenProvider.name).toBe('Opencode Zen')
  })

  test('supports api key method', () => {
    expect(OpencodeZenProvider.methods.length).toBeGreaterThan(0)
    const apiMethod = OpencodeZenProvider.methods.find(m => m.type === 'api')
    expect(apiMethod).toBeDefined()
    expect(apiMethod?.label).toBe('API Key')
  })

  test('getCredential returns undefined when no credential stored', async () => {
    const credential = await OpencodeZenProvider.getCredential()
    expect(credential).toBeUndefined()
  })

  test('getCredential returns stored credential', async () => {
    await CredentialStorage.add('opencode-zen', { type: 'api', key: 'test-key' })
    const credential = await OpencodeZenProvider.getCredential()
    expect(credential).toEqual({ type: 'api', key: 'test-key' })
  })

  test('getHeaders returns Authorization header', async () => {
    const credential = { type: 'api' as const, key: 'sk-test-123' }
    const headers = await OpencodeZenProvider.getHeaders(credential)
    expect(headers['Authorization']).toBe('Bearer sk-test-123')
  })

  test('getHeaders returns empty for non-api credential', async () => {
    const credential = { type: 'oauth' as const, accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 }
    const headers = await OpencodeZenProvider.getHeaders(credential)
    expect(headers).toEqual({})
  })

  test('getEndpoint returns correct URL', () => {
    const endpoint = OpencodeZenProvider.getEndpoint('gpt-4')
    expect(endpoint).toBe('https://opencode.ai/api/v1/chat/completions')
  })

  test('authorize with api key stores credential', async () => {
    const apiMethod = OpencodeZenProvider.methods.find(m => m.type === 'api')!
    const result = await apiMethod.authorize({ key: 'sk-new-key' })
    expect(result.type).toBe('success')
    expect(result.credential).toEqual({ type: 'api', key: 'sk-new-key' })

    const stored = await CredentialStorage.get('opencode-zen')
    expect(stored).toEqual([{ type: 'api', key: 'sk-new-key' }])
  })

  test('authorize fails when no key provided', async () => {
    const apiMethod = OpencodeZenProvider.methods.find(m => m.type === 'api')!
    const result = await apiMethod.authorize({})
    expect(result.type).toBe('failed')
    expect(result.error).toBeDefined()
  })
})
