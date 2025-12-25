import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import type { OAuthCredential } from '../src/types'

const originalFetch = global.fetch

describe('refreshAntigravityToken', () => {
  afterEach(() => {
    global.fetch = originalFetch
  })

  test('refreshes token successfully', async () => {
    const mockTokenResponse = {
      access_token: 'new_access_token',
      expires_in: 3600,
      refresh_token: 'new_refresh_token',
    }

    global.fetch = mock(async () =>
      new Response(JSON.stringify(mockTokenResponse), { status: 200 })
    )

    const { refreshAntigravityToken } = await import('../src/providers/antigravity-oauth')
    const currentCredential: OAuthCredential = {
      type: 'oauth',
      accessToken: 'old_access_token',
      refreshToken: 'old_refresh_token|project-123',
      expiresAt: Date.now() - 1000,
    }

    const result = await refreshAntigravityToken(currentCredential)

    expect(result.accessToken).toBe('new_access_token')
    expect(result.refreshToken).toBe('new_refresh_token|project-123')
    expect(result.expiresAt).toBeGreaterThan(Date.now())
  })

  test('keeps original refresh token if not rotated', async () => {
    const mockTokenResponse = {
      access_token: 'new_access_token',
      expires_in: 3600,
    }

    global.fetch = mock(async () =>
      new Response(JSON.stringify(mockTokenResponse), { status: 200 })
    )

    const { refreshAntigravityToken } = await import('../src/providers/antigravity-oauth')
    const currentCredential: OAuthCredential = {
      type: 'oauth',
      accessToken: 'old_access_token',
      refreshToken: 'keep_this_token|proj-abc',
      expiresAt: Date.now() - 1000,
    }

    const result = await refreshAntigravityToken(currentCredential)

    expect(result.accessToken).toBe('new_access_token')
    expect(result.refreshToken).toBe('keep_this_token|proj-abc')
  })

  test('handles refresh token without projectId suffix', async () => {
    const mockTokenResponse = {
      access_token: 'new_token',
      expires_in: 7200,
      refresh_token: 'rotated_token',
    }

    global.fetch = mock(async () =>
      new Response(JSON.stringify(mockTokenResponse), { status: 200 })
    )

    const { refreshAntigravityToken } = await import('../src/providers/antigravity-oauth')
    const currentCredential: OAuthCredential = {
      type: 'oauth',
      accessToken: 'old_token',
      refreshToken: 'simple_refresh_token',
      expiresAt: Date.now() - 1000,
    }

    const result = await refreshAntigravityToken(currentCredential)

    expect(result.accessToken).toBe('new_token')
    expect(result.refreshToken).toBe('rotated_token|')
  })

  test('throws error when refresh token is missing', async () => {
    const { refreshAntigravityToken } = await import('../src/providers/antigravity-oauth')
    const currentCredential: OAuthCredential = {
      type: 'oauth',
      accessToken: 'some_token',
      refreshToken: '',
      expiresAt: Date.now() - 1000,
    }

    await expect(refreshAntigravityToken(currentCredential)).rejects.toThrow(
      'Missing refresh token'
    )
  })

  test('throws error when refresh token is undefined', async () => {
    const { refreshAntigravityToken } = await import('../src/providers/antigravity-oauth')
    const currentCredential: OAuthCredential = {
      type: 'oauth',
      accessToken: 'some_token',
      refreshToken: undefined as any,
      expiresAt: Date.now() - 1000,
    }

    await expect(refreshAntigravityToken(currentCredential)).rejects.toThrow(
      'Missing refresh token'
    )
  })

  test('throws error on token refresh failure', async () => {
    global.fetch = mock(async () =>
      new Response('{"error": "invalid_grant"}', { status: 400 })
    )

    const { refreshAntigravityToken } = await import('../src/providers/antigravity-oauth')
    const currentCredential: OAuthCredential = {
      type: 'oauth',
      accessToken: 'old_token',
      refreshToken: 'expired_refresh|proj',
      expiresAt: Date.now() - 1000,
    }

    await expect(refreshAntigravityToken(currentCredential)).rejects.toThrow(
      'Token refresh failed: {"error": "invalid_grant"}'
    )
  })

  test('throws error on 401 response', async () => {
    global.fetch = mock(async () =>
      new Response('Unauthorized', { status: 401 })
    )

    const { refreshAntigravityToken } = await import('../src/providers/antigravity-oauth')
    const currentCredential: OAuthCredential = {
      type: 'oauth',
      accessToken: 'old_token',
      refreshToken: 'bad_token|proj',
      expiresAt: Date.now() - 1000,
    }

    await expect(refreshAntigravityToken(currentCredential)).rejects.toThrow(
      'Token refresh failed: Unauthorized'
    )
  })

  test('preserves other credential properties', async () => {
    const mockTokenResponse = {
      access_token: 'new_access',
      expires_in: 3600,
    }

    global.fetch = mock(async () =>
      new Response(JSON.stringify(mockTokenResponse), { status: 200 })
    )

    const { refreshAntigravityToken } = await import('../src/providers/antigravity-oauth')
    const currentCredential: OAuthCredential = {
      type: 'oauth',
      accessToken: 'old_access',
      refreshToken: 'refresh|proj',
      expiresAt: Date.now() - 1000,
      email: 'user@example.com',
      projectId: 'original-project',
    }

    const result = await refreshAntigravityToken(currentCredential)

    expect(result.type).toBe('oauth')
    expect(result.email).toBe('user@example.com')
    expect(result.projectId).toBe('original-project')
  })

  test('sends correct request body', async () => {
    let capturedBody: URLSearchParams | undefined

    global.fetch = mock(async (_url: string | URL | Request, options?: RequestInit) => {
      if (options?.body instanceof URLSearchParams) {
        capturedBody = options.body
      }
      return new Response(
        JSON.stringify({ access_token: 'new', expires_in: 3600 }),
        { status: 200 }
      )
    })

    const { refreshAntigravityToken } = await import('../src/providers/antigravity-oauth')
    const currentCredential: OAuthCredential = {
      type: 'oauth',
      accessToken: 'old',
      refreshToken: 'my_refresh_token|my-project',
      expiresAt: Date.now() - 1000,
    }

    await refreshAntigravityToken(currentCredential)

    expect(capturedBody?.get('refresh_token')).toBe('my_refresh_token')
    expect(capturedBody?.get('grant_type')).toBe('refresh_token')
  })

  test('calculates expiry correctly based on expires_in', async () => {
    const beforeCall = Date.now()
    const mockTokenResponse = {
      access_token: 'new_token',
      expires_in: 7200,
    }

    global.fetch = mock(async () =>
      new Response(JSON.stringify(mockTokenResponse), { status: 200 })
    )

    const { refreshAntigravityToken } = await import('../src/providers/antigravity-oauth')
    const currentCredential: OAuthCredential = {
      type: 'oauth',
      accessToken: 'old',
      refreshToken: 'refresh|proj',
      expiresAt: Date.now() - 1000,
    }

    const result = await refreshAntigravityToken(currentCredential)
    const afterCall = Date.now()

    expect(result.expiresAt).toBeGreaterThanOrEqual(beforeCall + 7200 * 1000)
    expect(result.expiresAt).toBeLessThanOrEqual(afterCall + 7200 * 1000)
  })
})

describe('authorizeAntigravity', () => {
  afterEach(() => {
    global.fetch = originalFetch
    mock.restore()
  })

  test('returns AuthStep with correct URL parameters', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback'),
        close: async () => {},
      }),
    }))

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()

    expect(result.type).toBe('intermediate')
    expect(result.url).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(result.url).toContain('client_id=')
    expect(result.url).toContain('code_challenge=')
    expect(result.url).toContain('code_challenge_method=S256')
    expect(result.url).toContain('access_type=offline')
    expect(result.url).toContain('prompt=consent')
    expect(result.url).toContain('response_type=code')
    expect(result.url).toContain('redirect_uri=')
    expect(result.message).toBe('Waiting for browser authentication...')
    expect(result.auto).toBe(true)
    expect(typeof result.callback).toBe('function')
  })

  test('includes scope in URL', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback'),
        close: async () => {},
      }),
    }))

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()

    expect(result.url).toContain('scope=')
  })

  test('includes projectId in state when provided', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback'),
        close: async () => {},
      }),
    }))

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity('my-custom-project')

    const url = new URL(result.url!)
    const state = url.searchParams.get('state')
    expect(state).toBeDefined()

    const decoded = JSON.parse(Buffer.from(state!, 'base64url').toString('utf8'))
    expect(decoded.projectId).toBe('my-custom-project')
    expect(decoded.verifier).toBeDefined()
  })

  test('state contains verifier for PKCE', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback'),
        close: async () => {},
      }),
    }))

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()

    const url = new URL(result.url!)
    const state = url.searchParams.get('state')
    const decoded = JSON.parse(Buffer.from(state!, 'base64url').toString('utf8'))
    expect(decoded.verifier).toBeDefined()
    expect(typeof decoded.verifier).toBe('string')
    expect(decoded.verifier.length).toBeGreaterThan(0)
  })

  test('callback returns failed when no code in callback URL', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback'),
        close: async () => {},
      }),
    }))

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('failed')
    expect((authResult as any).error).toBe('No code received in callback')
  })

  test('callback returns failed on token exchange failure', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=valid_code'),
        close: async () => {},
      }),
    }))

    global.fetch = mock(async () =>
      new Response('Bad Request', { status: 400 })
    )

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('failed')
    expect((authResult as any).error).toContain('Token exchange failed')
  })

  test('callback returns failed when refresh token is missing', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=valid_code'),
        close: async () => {},
      }),
    }))

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'access_123',
            expires_in: 3600,
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({ email: 'test@example.com' }), {
          status: 200,
        })
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('failed')
    expect((authResult as any).error).toBe('Missing refresh token in response')
  })

  test('callback returns success with valid OAuth flow', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=valid_code'),
        close: async () => {},
      }),
    }))

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'access_token_123',
            expires_in: 3600,
            refresh_token: 'refresh_token_456',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({ email: 'user@example.com' }), {
          status: 200,
        })
      }
      if (urlStr.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({ cloudaicompanionProject: 'fetched-project-id' }),
          { status: 200 }
        )
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('success')
    const credential = (authResult as any).credential as OAuthCredential
    expect(credential.type).toBe('oauth')
    expect(credential.accessToken).toBe('access_token_123')
    expect(credential.refreshToken).toBe('refresh_token_456')
    expect(credential.email).toBe('user@example.com')
    expect(credential.projectId).toBe('fetched-project-id')
  })

  test('callback uses provided projectId instead of fetching', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=valid_code'),
        close: async () => {},
      }),
    }))

    let loadCodeAssistCalled = false
    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('loadCodeAssist')) {
        loadCodeAssistCalled = true
        return new Response(
          JSON.stringify({ cloudaicompanionProject: 'should-not-use' }),
          { status: 200 }
        )
      }
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'access_123',
            expires_in: 3600,
            refresh_token: 'refresh_456',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({ email: 'test@test.com' }), {
          status: 200,
        })
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity('explicit-project')
    const authResult = await result.callback!()

    expect(authResult.type).toBe('success')
    const credential = (authResult as any).credential as OAuthCredential
    expect(credential.projectId).toBe('explicit-project')
    expect(loadCodeAssistCalled).toBe(false)
  })

  test('callback handles userinfo failure gracefully', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=valid_code'),
        close: async () => {},
      }),
    }))

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'access_123',
            expires_in: 3600,
            refresh_token: 'refresh_456',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response('Unauthorized', { status: 401 })
      }
      if (urlStr.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({ cloudaicompanionProject: 'proj-123' }),
          { status: 200 }
        )
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('success')
    const credential = (authResult as any).credential as OAuthCredential
    expect(credential.email).toBeUndefined()
  })

  test('callback handles errors and closes listener', async () => {
    let listenerClosed = false
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => {
          throw new Error('Connection timeout')
        },
        close: async () => {
          listenerClosed = true
        },
      }),
    }))

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('failed')
    expect((authResult as any).error).toBe('Connection timeout')
    expect(listenerClosed).toBe(true)
  })

  test('callback handles non-Error exceptions', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => {
          throw 'string error'
        },
        close: async () => {},
      }),
    }))

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('failed')
    expect((authResult as any).error).toBe('Unknown error')
  })

  test('closes listener after successful token exchange', async () => {
    let listenerClosed = false
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=valid'),
        close: async () => {
          listenerClosed = true
        },
      }),
    }))

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'token',
            expires_in: 3600,
            refresh_token: 'refresh',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({}), { status: 200 })
      }
      if (urlStr.includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ cloudaicompanionProject: 'proj' }), { status: 200 })
      }
      return new Response('', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    await result.callback!()

    expect(listenerClosed).toBe(true)
  })
})

describe('fetchProjectID integration tests', () => {
  afterEach(() => {
    global.fetch = originalFetch
    mock.restore()
  })

  test('returns project ID from string response', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=test'),
        close: async () => {},
      }),
    }))

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'test_token',
            expires_in: 3600,
            refresh_token: 'refresh',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({}), { status: 200 })
      }
      if (urlStr.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({ cloudaicompanionProject: 'string-project-id' }),
          { status: 200 }
        )
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('success')
    expect((authResult as any).credential.projectId).toBe('string-project-id')
  })

  test('returns project ID from object response', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=test'),
        close: async () => {},
      }),
    }))

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'test_token',
            expires_in: 3600,
            refresh_token: 'refresh',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({}), { status: 200 })
      }
      if (urlStr.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: { id: 'object-project-id' },
          }),
          { status: 200 }
        )
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('success')
    expect((authResult as any).credential.projectId).toBe('object-project-id')
  })

  test('returns undefined projectId when all endpoints fail', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=test'),
        close: async () => {},
      }),
    }))

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'test_token',
            expires_in: 3600,
            refresh_token: 'refresh',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({}), { status: 200 })
      }
      if (urlStr.includes('loadCodeAssist')) {
        return new Response('Service Unavailable', { status: 503 })
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('success')
    expect((authResult as any).credential.projectId).toBeUndefined()
  })

  test('tries fallback endpoints when first fails', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=test'),
        close: async () => {},
      }),
    }))

    let callCount = 0
    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'test_token',
            expires_in: 3600,
            refresh_token: 'refresh',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({}), { status: 200 })
      }
      if (urlStr.includes('loadCodeAssist')) {
        callCount++
        if (callCount < 3) {
          return new Response('Error', { status: 500 })
        }
        return new Response(
          JSON.stringify({ cloudaicompanionProject: 'fallback-project' }),
          { status: 200 }
        )
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('success')
    expect((authResult as any).credential.projectId).toBe('fallback-project')
    expect(callCount).toBeGreaterThanOrEqual(3)
  })

  test('handles fetch throwing an error for loadCodeAssist', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=test'),
        close: async () => {},
      }),
    }))

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'test_token',
            expires_in: 3600,
            refresh_token: 'refresh',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({}), { status: 200 })
      }
      if (urlStr.includes('loadCodeAssist')) {
        throw new Error('Network error')
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('success')
    expect((authResult as any).credential.projectId).toBeUndefined()
  })

  test('handles empty string cloudaicompanionProject', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=test'),
        close: async () => {},
      }),
    }))

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'test_token',
            expires_in: 3600,
            refresh_token: 'refresh',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({}), { status: 200 })
      }
      if (urlStr.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({ cloudaicompanionProject: '' }),
          { status: 200 }
        )
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('success')
    expect((authResult as any).credential.projectId).toBeUndefined()
  })

  test('handles object with empty id', async () => {
    mock.module('../src/providers/antigravity-server', () => ({
      startOAuthListener: async () => ({
        waitForCallback: async () => new URL('http://localhost:51121/oauth-callback?code=test'),
        close: async () => {},
      }),
    }))

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'test_token',
            expires_in: 3600,
            refresh_token: 'refresh',
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({}), { status: 200 })
      }
      if (urlStr.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({ cloudaicompanionProject: { id: '' } }),
          { status: 200 }
        )
      }
      return new Response('Not Found', { status: 404 })
    })

    const { authorizeAntigravity } = await import('../src/providers/antigravity-oauth')
    const result = await authorizeAntigravity()
    const authResult = await result.callback!()

    expect(authResult.type).toBe('success')
    expect((authResult as any).credential.projectId).toBeUndefined()
  })
})
