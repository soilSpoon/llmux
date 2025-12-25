import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { GithubCopilotProvider } from '../../src/providers/github-copilot'
import { CredentialStorage } from '../../src/storage'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('GithubCopilotProvider', () => {
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
    expect(GithubCopilotProvider.id).toBe('github-copilot')
    expect(GithubCopilotProvider.name).toBe('GitHub Copilot')
  })

  test('supports device-flow method', () => {
    const deviceMethod = GithubCopilotProvider.methods.find(m => m.type === 'device-flow')
    expect(deviceMethod).toBeDefined()
    expect(deviceMethod?.label).toBe('GitHub Device Flow')
  })

  test('getCredential returns undefined when no credential stored', async () => {
    const credential = await GithubCopilotProvider.getCredential()
    expect(credential).toBeUndefined()
  })

  test('getCredential returns stored credential', async () => {
    const oauth = {
      type: 'oauth' as const,
      accessToken: 'ghu_test',
      refreshToken: 'ghr_test',
      expiresAt: Date.now() + 3600000,
    }
    await CredentialStorage.add('github-copilot', oauth)
    const credential = await GithubCopilotProvider.getCredential()
    expect(credential).toEqual(oauth)
  })

  test('getHeaders returns Authorization and Editor-Version headers', async () => {
    const oauth = {
      type: 'oauth' as const,
      accessToken: 'ghu_test_token',
      refreshToken: 'ghr_test',
      expiresAt: Date.now() + 3600000,
    }
    const headers = await GithubCopilotProvider.getHeaders(oauth)
    expect(headers['Authorization']).toBe('Bearer ghu_test_token')
    expect(headers['Editor-Version']).toBe('llmux/1.0')
  })

  test('getHeaders returns empty for api key credential', async () => {
    const credential = { type: 'api' as const, key: 'test-key' }
    const headers = await GithubCopilotProvider.getHeaders(credential)
    expect(headers).toEqual({})
  })

  test('getEndpoint returns correct URL', () => {
    const endpoint = GithubCopilotProvider.getEndpoint('gpt-4')
    expect(endpoint).toBe('https://api.githubcopilot.com/chat/completions')
  })
})

describe('GithubCopilotDeviceFlow', () => {
  test('requestDeviceCode returns code info', async () => {
    const { requestDeviceCode } = await import('../../src/providers/github-copilot')
    const mockResponse = {
      device_code: 'device_123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }

    const originalFetch = global.fetch
    global.fetch = mock(async () => new Response(JSON.stringify(mockResponse)))

    try {
      const result = await requestDeviceCode()
      expect(result.userCode).toBe('ABCD-1234')
      expect(result.verificationUri).toBe('https://github.com/login/device')
      expect(result.deviceCode).toBe('device_123')
      expect(result.interval).toBe(5)
    } finally {
      global.fetch = originalFetch
    }
  })
})
