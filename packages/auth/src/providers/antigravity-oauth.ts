import { generatePKCE } from '@openauthjs/openauth/pkce'
import type { OAuthCredential } from '../types'
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_HEADERS,
  ANTIGRAVITY_LOAD_ENDPOINTS,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
} from './antigravity-constants'
import { startOAuthListener } from './antigravity-server'
import type { AuthResult, AuthStep } from './base'

interface PkcePair {
  challenge: string
  verifier: string
}

interface AntigravityAuthState {
  verifier: string
  projectId: string
}

interface AntigravityTokenResponse {
  access_token: string
  expires_in: number
  refresh_token: string
}

interface AntigravityUserInfo {
  email?: string
}

function encodeState(payload: AntigravityAuthState): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

// Unused locally but kept for completeness if needed for debugging
/*
function decodeState(state: string): AntigravityAuthState {
  const normalized = state.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  )
  const json = Buffer.from(padded, "base64").toString("utf8")
  const parsed = JSON.parse(json)
  return {
    verifier: parsed.verifier,
    projectId: parsed.projectId || "",
  }
}
*/

interface LoadCodeAssistResponse {
  cloudaicompanionProject?: string | { id: string }
}

export async function fetchAntigravityProjectID(accessToken: string): Promise<string> {
  const loadHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'google-api-nodejs-client/9.15.1',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': ANTIGRAVITY_HEADERS['Client-Metadata'],
  }

  const loadEndpoints = Array.from(
    new Set<string>([...ANTIGRAVITY_LOAD_ENDPOINTS, ...ANTIGRAVITY_ENDPOINT_FALLBACKS])
  )

  for (const baseEndpoint of loadEndpoints) {
    try {
      const url = `${baseEndpoint}/v1internal:loadCodeAssist`
      const response = await fetch(url, {
        method: 'POST',
        headers: loadHeaders,
        body: JSON.stringify({
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          },
        }),
      })

      if (!response.ok) {
        continue
      }

      const data = (await response.json()) as LoadCodeAssistResponse
      if (typeof data.cloudaicompanionProject === 'string' && data.cloudaicompanionProject) {
        return data.cloudaicompanionProject
      }
      if (
        data.cloudaicompanionProject &&
        typeof data.cloudaicompanionProject === 'object' &&
        typeof data.cloudaicompanionProject.id === 'string' &&
        data.cloudaicompanionProject.id
      ) {
        return data.cloudaicompanionProject.id
      }
    } catch {
      // ignore
    }
  }
  return ''
}

export async function authorizeAntigravity(projectId = ''): Promise<AuthStep> {
  const listener = await startOAuthListener()
  const pkce = (await generatePKCE()) as PkcePair

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', ANTIGRAVITY_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', ANTIGRAVITY_REDIRECT_URI)
  url.searchParams.set('scope', ANTIGRAVITY_SCOPES.join(' '))
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set(
    'state',
    encodeState({ verifier: pkce.verifier, projectId: projectId || '' })
  )
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')

  return {
    type: 'intermediate',
    url: url.toString(),
    message: 'Waiting for browser authentication...',
    auto: true,
    callback: async (): Promise<AuthResult> => {
      try {
        const callbackUrl = await listener.waitForCallback()
        const code = callbackUrl.searchParams.get('code')

        if (!code) {
          return { type: 'failed', error: 'No code received in callback' }
        }

        // We close the listener after getting the code
        await listener.close()

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: ANTIGRAVITY_CLIENT_ID,
            client_secret: ANTIGRAVITY_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: ANTIGRAVITY_REDIRECT_URI,
            code_verifier: pkce.verifier,
          }),
        })

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text()
          return {
            type: 'failed',
            error: `Token exchange failed: ${errorText}`,
          }
        }

        const tokenPayload = (await tokenResponse.json()) as AntigravityTokenResponse

        const userInfoResponse = await fetch(
          'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
          {
            headers: {
              Authorization: `Bearer ${tokenPayload.access_token}`,
            },
          }
        )

        const userInfo = userInfoResponse.ok
          ? ((await userInfoResponse.json()) as AntigravityUserInfo)
          : {}

        const refreshToken = tokenPayload.refresh_token
        if (!refreshToken) {
          return { type: 'failed', error: 'Missing refresh token in response' }
        }

        let effectiveProjectId = projectId
        if (!effectiveProjectId) {
          effectiveProjectId = await fetchAntigravityProjectID(tokenPayload.access_token)
        }

        const credential: OAuthCredential = {
          type: 'oauth',
          accessToken: tokenPayload.access_token,
          refreshToken: refreshToken,
          expiresAt: Date.now() + tokenPayload.expires_in * 1000,
          email: userInfo.email,
          projectId: effectiveProjectId || undefined,
        }

        return {
          type: 'success',
          credential,
        }
      } catch (error) {
        // Ensure listener is closed on error
        await listener.close().catch(() => {})
        return {
          type: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    },
  }
}

export async function refreshAntigravityToken(
  currentCredential: OAuthCredential
): Promise<OAuthCredential> {
  const [refreshToken, projectId] = (currentCredential.refreshToken || '').split('|')

  if (!refreshToken) {
    throw new Error('Missing refresh token')
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text()
    throw new Error(`Token refresh failed: ${errorText}`)
  }

  const tokenPayload = (await tokenResponse.json()) as AntigravityTokenResponse

  // The refresh token might be rotated, but usually it stays the same.
  // If a new one is returned, we should use it.
  const newRefreshToken = tokenPayload.refresh_token || refreshToken

  let effectiveProjectId = currentCredential.projectId || projectId
  if (!effectiveProjectId) {
    try {
      effectiveProjectId = await fetchAntigravityProjectID(tokenPayload.access_token)
    } catch {
      // ignore
    }
  }

  const storedRefresh = `${newRefreshToken}|${effectiveProjectId || ''}`

  return {
    ...currentCredential,
    accessToken: tokenPayload.access_token,
    refreshToken: storedRefresh,
    expiresAt: Date.now() + tokenPayload.expires_in * 1000,
    projectId: effectiveProjectId || undefined,
  }
}
