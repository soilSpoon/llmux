// Codex OAuth Constants (matches openai/codex CLI)
export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
export const TOKEN_URL = 'https://auth.openai.com/oauth/token'
export const REDIRECT_URI = 'http://localhost:1455/auth/callback'
export const SCOPE = 'openid profile email offline_access'

// Types
export interface PKCEPair {
  verifier: string
  challenge: string
}

export interface AuthorizationFlow {
  pkce: PKCEPair
  state: string
  url: string
}

export interface ParsedAuthInput {
  code?: string
  state?: string
}

export type TokenResult =
  | { type: 'success'; access: string; refresh: string; expires: number; idToken?: string }
  | { type: 'failed'; error?: string }

export interface JWTPayload {
  sub?: string
  email?: string
  org_id?: string
  [key: string]: unknown
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in?: number
  id_token?: string
}

interface ErrorResponse {
  error: string
  error_description?: string
}

export function createState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function generatePKCE(): Promise<PKCEPair> {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const verifier = base64UrlEncode(array)

  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const challenge = base64UrlEncode(new Uint8Array(hash))

  return { verifier, challenge }
}

function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function createAuthorizationFlow(): Promise<AuthorizationFlow> {
  const pkce = await generatePKCE()
  const state = createState()

  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  // Codex-specific parameters
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'codex_cli_rs')
  url.searchParams.set('id_token_add_organizations', 'true')

  return { pkce, state, url: url.toString() }
}

export function parseAuthorizationInput(input: string): ParsedAuthInput {
  if (!input || input.trim() === '') {
    return {}
  }

  const trimmed = input.trim()

  // Try parsing as URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed)
      const code = url.searchParams.get('code') ?? undefined
      const state = url.searchParams.get('state') ?? undefined
      return { code, state }
    } catch {
      // Not a valid URL, continue
    }
  }

  // Try code#state format
  if (trimmed.includes('#')) {
    const [code, state] = trimmed.split('#')
    return { code, state }
  }

  // Try query string format
  if (trimmed.includes('=')) {
    const params = new URLSearchParams(trimmed)
    const code = params.get('code') ?? undefined
    const state = params.get('state') ?? undefined
    if (code) {
      return { code, state }
    }
  }

  // Raw code
  return { code: trimmed }
}

export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return null
    }

    const payload = parts[1]
    if (!payload) {
      return null
    }

    // Handle URL-safe base64
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    // Add padding if needed
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const decoded = atob(padded)
    return JSON.parse(decoded) as JWTPayload
  } catch {
    return null
  }
}

function isTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return typeof obj.access_token === 'string' && typeof obj.refresh_token === 'string'
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return typeof obj.error === 'string'
}

export async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  redirectUri: string = REDIRECT_URI
): Promise<TokenResult> {
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    })

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      let errorMessage = 'token_exchange_failed'
      try {
        const errorData = await response.json()
        if (isErrorResponse(errorData)) {
          errorMessage = errorData.error
        }
      } catch {
        // Ignore parse errors, use default
      }
      return { type: 'failed', error: errorMessage }
    }

    const data = await response.json()
    if (!isTokenResponse(data)) {
      return { type: 'failed', error: 'invalid_token_response' }
    }

    const expiresIn = data.expires_in ?? 3600
    const expires = Date.now() + expiresIn * 1000

    return {
      type: 'success',
      access: data.access_token,
      refresh: data.refresh_token,
      expires,
      idToken: data.id_token,
    }
  } catch (error) {
    return { type: 'failed', error: String(error) }
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResult> {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    })

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      let errorMessage = 'refresh_failed'
      try {
        const errorData = await response.json()
        if (isErrorResponse(errorData)) {
          errorMessage = errorData.error
        }
      } catch {
        // Ignore parse errors, use default
      }
      return { type: 'failed', error: errorMessage }
    }

    const data = await response.json()
    if (!isTokenResponse(data)) {
      return { type: 'failed', error: 'invalid_token_response' }
    }

    const expiresIn = data.expires_in ?? 3600
    const expires = Date.now() + expiresIn * 1000

    return {
      type: 'success',
      access: data.access_token,
      refresh: data.refresh_token ?? refreshToken,
      expires,
    }
  } catch (error) {
    return { type: 'failed', error: String(error) }
  }
}
