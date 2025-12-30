import { describe, it, expect, mock, afterEach } from 'bun:test'
import {
  CLIENT_ID,
  AUTHORIZE_URL,
  TOKEN_URL,
  REDIRECT_URI,
  SCOPE,
  createState,
  generatePKCE,
  createAuthorizationFlow,
  parseAuthorizationInput,
  decodeJWT,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '../../src/codex/oauth'

describe('Codex OAuth', () => {
  describe('constants', () => {
    it('should have correct CLIENT_ID', () => {
      expect(CLIENT_ID).toBe('app_EMoamEEZ73f0CkXaXp7hrann')
    })

    it('should have correct AUTHORIZE_URL', () => {
      expect(AUTHORIZE_URL).toBe('https://auth.openai.com/oauth/authorize')
    })

    it('should have correct TOKEN_URL', () => {
      expect(TOKEN_URL).toBe('https://auth.openai.com/oauth/token')
    })

    it('should have correct REDIRECT_URI', () => {
      expect(REDIRECT_URI).toBe('http://localhost:1455/auth/callback')
    })

    it('should have correct SCOPE', () => {
      expect(SCOPE).toBe('openid profile email offline_access')
    })
  })

  describe('createState', () => {
    it('should generate 32-character hex string', () => {
      const state = createState()
      expect(state).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should generate unique values', () => {
      const state1 = createState()
      const state2 = createState()
      expect(state1).not.toBe(state2)
    })
  })

  describe('generatePKCE', () => {
    it('should generate verifier and challenge', async () => {
      const pkce = await generatePKCE()
      expect(pkce.verifier).toBeDefined()
      expect(pkce.challenge).toBeDefined()
      expect(typeof pkce.verifier).toBe('string')
      expect(typeof pkce.challenge).toBe('string')
    })

    it('should generate verifier with sufficient length', async () => {
      const pkce = await generatePKCE()
      expect(pkce.verifier.length).toBeGreaterThanOrEqual(43)
    })

    it('should generate URL-safe challenge', async () => {
      const pkce = await generatePKCE()
      expect(pkce.challenge).not.toContain('+')
      expect(pkce.challenge).not.toContain('/')
      expect(pkce.challenge).not.toContain('=')
    })
  })

  describe('createAuthorizationFlow', () => {
    it('should return pkce, state, and url', async () => {
      const flow = await createAuthorizationFlow()
      expect(flow.pkce).toBeDefined()
      expect(flow.state).toBeDefined()
      expect(flow.url).toBeDefined()
    })

    it('should include required OAuth parameters in URL', async () => {
      const flow = await createAuthorizationFlow()
      const url = new URL(flow.url)

      expect(url.origin + url.pathname).toBe(AUTHORIZE_URL)
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
      expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
      expect(url.searchParams.get('scope')).toBe(SCOPE)
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    })

    it('should include Codex-specific parameters', async () => {
      const flow = await createAuthorizationFlow()
      const url = new URL(flow.url)

      expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true')
      expect(url.searchParams.get('originator')).toBe('codex_cli_rs')
      expect(url.searchParams.get('id_token_add_organizations')).toBe('true')
    })
  })

  describe('parseAuthorizationInput', () => {
    it('should parse code from full redirect URL', () => {
      const input = 'http://localhost:1455/auth/callback?code=abc123&state=xyz789'
      const result = parseAuthorizationInput(input)
      expect(result.code).toBe('abc123')
      expect(result.state).toBe('xyz789')
    })

    it('should parse code#state format', () => {
      const input = 'abc123#xyz789'
      const result = parseAuthorizationInput(input)
      expect(result.code).toBe('abc123')
      expect(result.state).toBe('xyz789')
    })

    it('should parse raw code', () => {
      const input = 'abc123'
      const result = parseAuthorizationInput(input)
      expect(result.code).toBe('abc123')
      expect(result.state).toBeUndefined()
    })

    it('should handle empty input', () => {
      const result = parseAuthorizationInput('')
      expect(result.code).toBeUndefined()
    })
  })

  describe('decodeJWT', () => {
    it('should decode valid JWT payload', () => {
      const payload = { sub: 'user123', email: 'test@example.com' }
      const base64Payload = btoa(JSON.stringify(payload))
      const token = `header.${base64Payload}.signature`

      const result = decodeJWT(token)
      expect(result?.sub).toBe('user123')
      expect(result?.email).toBe('test@example.com')
    })

    it('should return null for invalid JWT', () => {
      expect(decodeJWT('invalid')).toBeNull()
      expect(decodeJWT('')).toBeNull()
      expect(decodeJWT('a.b')).toBeNull()
    })

    it('should handle URL-safe base64', () => {
      const payload = { test: 'value+with/special=chars' }
      const base64Payload = btoa(JSON.stringify(payload))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      const token = `header.${base64Payload}.signature`

      const result = decodeJWT(token)
      expect(result?.test).toBe('value+with/special=chars')
    })
  })

  describe('exchangeAuthorizationCode', () => {
    const originalFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should exchange code for tokens successfully', async () => {
      const mockResponse = {
        access_token: 'access123',
        refresh_token: 'refresh456',
        expires_in: 3600,
      }

      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
      ) as unknown as typeof fetch

      const result = await exchangeAuthorizationCode('code123', 'verifier456')

      expect(result.type).toBe('success')
      if (result.type === 'success') {
        expect(result.access).toBe('access123')
        expect(result.refresh).toBe('refresh456')
        expect(result.expires).toBeGreaterThan(Date.now())
      }
    })

    it('should return failed on error response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
      ) as unknown as typeof fetch

      const result = await exchangeAuthorizationCode('bad_code', 'verifier')
      expect(result.type).toBe('failed')
    })

    it('should call TOKEN_URL with correct parameters', async () => {
      let capturedUrl = ''
      let capturedBody = ''

      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        capturedUrl = url
        capturedBody = init?.body as string
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }))
        )
      }) as unknown as typeof fetch

      await exchangeAuthorizationCode('code123', 'verifier456')

      expect(capturedUrl).toBe(TOKEN_URL)
      expect(capturedBody).toContain('grant_type=authorization_code')
      expect(capturedBody).toContain('client_id=' + CLIENT_ID)
      expect(capturedBody).toContain('code=code123')
      expect(capturedBody).toContain('code_verifier=verifier456')
    })
  })

  describe('refreshAccessToken', () => {
    const originalFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should refresh tokens successfully', async () => {
      const mockResponse = {
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        expires_in: 3600,
      }

      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
      ) as unknown as typeof fetch

      const result = await refreshAccessToken('old_refresh')

      expect(result.type).toBe('success')
      if (result.type === 'success') {
        expect(result.access).toBe('new_access')
        expect(result.refresh).toBe('new_refresh')
      }
    })

    it('should return failed on error', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 }))
      ) as unknown as typeof fetch

      const result = await refreshAccessToken('expired_token')
      expect(result.type).toBe('failed')
    })

    it('should call TOKEN_URL with refresh_token grant type', async () => {
      let capturedBody = ''

      globalThis.fetch = mock((_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }))
        )
      }) as unknown as typeof fetch

      await refreshAccessToken('refresh123')

      expect(capturedBody).toContain('grant_type=refresh_token')
      expect(capturedBody).toContain('refresh_token=refresh123')
      expect(capturedBody).toContain('client_id=' + CLIENT_ID)
    })
  })
})
