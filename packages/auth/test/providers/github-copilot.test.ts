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
  let tempDir: string
  let originalHome: string | undefined
  let originalFetch: typeof global.fetch

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmux-auth-test-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    originalFetch = global.fetch
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    global.fetch = originalFetch
    await rm(tempDir, { recursive: true, force: true })
  })

  test('requestDeviceCode returns code info', async () => {
    const { requestDeviceCode } = await import('../../src/providers/github-copilot')
    const mockResponse = {
      device_code: 'device_123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }

    global.fetch = mock(async () => new Response(JSON.stringify(mockResponse)))

    const result = await requestDeviceCode()
    expect(result.userCode).toBe('ABCD-1234')
    expect(result.verificationUri).toBe('https://github.com/login/device')
    expect(result.deviceCode).toBe('device_123')
    expect(result.interval).toBe(5)
    expect(result.expiresIn).toBe(900)
  })

  test('requestDeviceCode sends correct request body', async () => {
    const { requestDeviceCode } = await import('../../src/providers/github-copilot')
    let capturedBody: string | undefined

    global.fetch = mock(async (url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return new Response(JSON.stringify({
        device_code: 'dc',
        user_code: 'UC',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }))
    })

    await requestDeviceCode()
    const body = JSON.parse(capturedBody!)
    expect(body.client_id).toBe('Iv1.b507a08c87ecfe98')
    expect(body.scope).toBe('read:user')
  })
})

describe('pollForToken', () => {
  let tempDir: string
  let originalHome: string | undefined
  let originalFetch: typeof global.fetch

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmux-auth-test-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    originalFetch = global.fetch
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    global.fetch = originalFetch
    await rm(tempDir, { recursive: true, force: true })
  })

  test('returns success with valid token', async () => {
    const { pollForToken } = await import('../../src/providers/github-copilot')

    global.fetch = mock(async () => new Response(JSON.stringify({
      access_token: 'ghu_access_123',
      refresh_token: 'ghr_refresh_456',
      expires_in: 28800,
    })))

    const result = await pollForToken('device_code_123', 0.001)
    expect(result.type).toBe('success')
    if (result.type === 'success') {
      expect(result.credential.type).toBe('oauth')
      expect(result.credential.accessToken).toBe('ghu_access_123')
      expect(result.credential.refreshToken).toBe('ghr_refresh_456')
    }
  })

  test('returns success with default expiresIn when not provided', async () => {
    const { pollForToken } = await import('../../src/providers/github-copilot')

    global.fetch = mock(async () => new Response(JSON.stringify({
      access_token: 'ghu_access',
    })))

    const beforeTime = Date.now()
    const result = await pollForToken('device_code', 0.001)
    
    expect(result.type).toBe('success')
    if (result.type === 'success') {
      expect(result.credential.refreshToken).toBe('')
      expect(result.credential.expiresAt).toBeGreaterThanOrEqual(beforeTime + 28800 * 1000)
    }
  })

  test('handles authorization_pending by retrying', async () => {
    const { pollForToken } = await import('../../src/providers/github-copilot')
    let callCount = 0

    global.fetch = mock(async () => {
      callCount++
      if (callCount < 3) {
        return new Response(JSON.stringify({ error: 'authorization_pending' }))
      }
      return new Response(JSON.stringify({
        access_token: 'ghu_success',
        refresh_token: 'ghr_success',
        expires_in: 3600,
      }))
    })

    const result = await pollForToken('device_code', 0.001)
    expect(callCount).toBe(3)
    expect(result.type).toBe('success')
  })

  test('handles slow_down response type', async () => {
    const { pollForToken } = await import('../../src/providers/github-copilot')
    let callCount = 0

    global.fetch = mock(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: 'slow_down' }))
      }
      return new Response(JSON.stringify({
        access_token: 'ghu_token',
        refresh_token: 'ghr_token',
        expires_in: 3600,
      }))
    })

    const result = await pollForToken('device_code', 0)
    expect(callCount).toBe(2)
    expect(result.type).toBe('success')
  }, 10000)

  test('returns failed on error response', async () => {
    const { pollForToken } = await import('../../src/providers/github-copilot')

    global.fetch = mock(async () => new Response(JSON.stringify({
      error: 'access_denied',
    })))

    const result = await pollForToken('device_code', 0.001)
    expect(result.type).toBe('failed')
    if (result.type === 'failed') {
      expect(result.error).toBe('access_denied')
    }
  })

  test('returns failed on expired_token error', async () => {
    const { pollForToken } = await import('../../src/providers/github-copilot')

    global.fetch = mock(async () => new Response(JSON.stringify({
      error: 'expired_token',
    })))

    const result = await pollForToken('device_code', 0.001)
    expect(result.type).toBe('failed')
    if (result.type === 'failed') {
      expect(result.error).toBe('expired_token')
    }
  })

  test('returns unknown error when no token and no error', async () => {
    const { pollForToken } = await import('../../src/providers/github-copilot')

    global.fetch = mock(async () => new Response(JSON.stringify({})))

    const result = await pollForToken('device_code', 0.001)
    expect(result.type).toBe('failed')
    if (result.type === 'failed') {
      expect(result.error).toBe('Unknown error')
    }
  })

  test('stores credential on success', async () => {
    const { pollForToken } = await import('../../src/providers/github-copilot')

    global.fetch = mock(async () => new Response(JSON.stringify({
      access_token: 'ghu_stored',
      refresh_token: 'ghr_stored',
      expires_in: 3600,
    })))

    await pollForToken('device_code', 0.001)
    const stored = await CredentialStorage.get('github-copilot')
    expect(stored).toHaveLength(1)
    expect(stored[0].type).toBe('oauth')
  })
})

describe('GithubCopilotProvider.refresh', () => {
  let tempDir: string
  let originalHome: string | undefined
  let originalFetch: typeof global.fetch

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmux-auth-test-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    originalFetch = global.fetch
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    global.fetch = originalFetch
    await rm(tempDir, { recursive: true, force: true })
  })

  test('refreshes token successfully', async () => {
    global.fetch = mock(async () => new Response(JSON.stringify({
      access_token: 'ghu_new_token',
      refresh_token: 'ghr_new_refresh',
      expires_in: 28800,
    })))

    const credential = {
      type: 'oauth' as const,
      accessToken: 'ghu_old',
      refreshToken: 'ghr_old',
      expiresAt: Date.now() - 1000,
    }

    const refreshed = await GithubCopilotProvider.refresh(credential)
    expect(refreshed.type).toBe('oauth')
    if (refreshed.type === 'oauth') {
      expect(refreshed.accessToken).toBe('ghu_new_token')
      expect(refreshed.refreshToken).toBe('ghr_new_refresh')
    }
  })

  test('keeps old refresh token if new one not provided', async () => {
    global.fetch = mock(async () => new Response(JSON.stringify({
      access_token: 'ghu_new',
      expires_in: 28800,
    })))

    const credential = {
      type: 'oauth' as const,
      accessToken: 'ghu_old',
      refreshToken: 'ghr_original',
      expiresAt: Date.now() - 1000,
    }

    const refreshed = await GithubCopilotProvider.refresh(credential)
    if (refreshed.type === 'oauth') {
      expect(refreshed.refreshToken).toBe('ghr_original')
    }
  })

  test('uses default expires_in when not provided', async () => {
    global.fetch = mock(async () => new Response(JSON.stringify({
      access_token: 'ghu_new',
    })))

    const beforeTime = Date.now()
    const credential = {
      type: 'oauth' as const,
      accessToken: 'ghu_old',
      refreshToken: 'ghr_old',
      expiresAt: Date.now() - 1000,
    }

    const refreshed = await GithubCopilotProvider.refresh(credential)
    if (refreshed.type === 'oauth') {
      expect(refreshed.expiresAt).toBeGreaterThanOrEqual(beforeTime + 28800 * 1000)
    }
  })

  test('throws error on refresh failure', async () => {
    global.fetch = mock(async () => new Response(JSON.stringify({
      error: 'invalid_grant',
    })))

    const credential = {
      type: 'oauth' as const,
      accessToken: 'ghu_old',
      refreshToken: 'ghr_old',
      expiresAt: Date.now() - 1000,
    }

    await expect(GithubCopilotProvider.refresh(credential)).rejects.toThrow(
      'Failed to refresh GitHub Copilot token: invalid_grant'
    )
  })

  test('throws unknown error when no token in response', async () => {
    global.fetch = mock(async () => new Response(JSON.stringify({})))

    const credential = {
      type: 'oauth' as const,
      accessToken: 'ghu_old',
      refreshToken: 'ghr_old',
      expiresAt: Date.now() - 1000,
    }

    await expect(GithubCopilotProvider.refresh(credential)).rejects.toThrow(
      'Unknown error refreshing GitHub Copilot token'
    )
  })

  test('returns credential unchanged if not OAuth', async () => {
    const apiCredential = { type: 'api' as const, key: 'test-key' }
    const result = await GithubCopilotProvider.refresh(apiCredential)
    expect(result).toEqual(apiCredential)
  })

  test('returns credential unchanged if no refresh token', async () => {
    const credential = {
      type: 'oauth' as const,
      accessToken: 'ghu_token',
      refreshToken: '',
      expiresAt: Date.now() - 1000,
    }
    const result = await GithubCopilotProvider.refresh(credential)
    expect(result).toEqual(credential)
  })

  test('sends correct request body for refresh', async () => {
    let capturedBody: string | undefined

    global.fetch = mock(async (url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return new Response(JSON.stringify({
        access_token: 'ghu_new',
        refresh_token: 'ghr_new',
        expires_in: 28800,
      }))
    })

    const credential = {
      type: 'oauth' as const,
      accessToken: 'ghu_old',
      refreshToken: 'ghr_test_token',
      expiresAt: Date.now() - 1000,
    }

    await GithubCopilotProvider.refresh(credential)
    const body = JSON.parse(capturedBody!)
    expect(body.client_id).toBe('Iv1.b507a08c87ecfe98')
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('ghr_test_token')
  })
})

describe('deviceFlowMethod.authorize', () => {
  let tempDir: string
  let originalHome: string | undefined
  let originalFetch: typeof global.fetch

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmux-auth-test-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
    originalFetch = global.fetch
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    global.fetch = originalFetch
    await rm(tempDir, { recursive: true, force: true })
  })

  test('authorize method succeeds with valid flow', async () => {
    let callCount = 0
    global.fetch = mock(async (url: string) => {
      callCount++
      if (url.includes('/device/code')) {
        return new Response(JSON.stringify({
          device_code: 'dc_123',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 0.001,
        }))
      }
      return new Response(JSON.stringify({
        access_token: 'ghu_token',
        refresh_token: 'ghr_token',
        expires_in: 28800,
      }))
    })

    const deviceMethod = GithubCopilotProvider.methods.find(m => m.type === 'device-flow')
    const result = await deviceMethod!.authorize()
    expect(result.type).toBe('success')
  })

  test('authorize method returns failed on error', async () => {
    global.fetch = mock(async () => {
      throw new Error('Network error')
    })

    const deviceMethod = GithubCopilotProvider.methods.find(m => m.type === 'device-flow')
    const result = await deviceMethod!.authorize()
    expect(result.type).toBe('failed')
    if (result.type === 'failed') {
      expect(result.error).toContain('Network error')
    }
  })
})
