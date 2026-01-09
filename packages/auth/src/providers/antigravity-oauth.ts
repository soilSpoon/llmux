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

// Caching for project ID resolution
const projectContextResultCache = new Map<string, ProjectIDAndTierResult>()

export function invalidateProjectContextCache(key?: string): void {
  if (key) {
    projectContextResultCache.delete(key)
  } else {
    projectContextResultCache.clear()
  }
}

function encodeState(payload: AntigravityAuthState): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

interface LoadCodeAssistResponse {
  cloudaicompanionProject?: string | { id: string }
  allowedTiers?: Array<{ id: string; name?: string }>
}

interface OnboardUserPayload {
  done?: boolean
  response?: {
    cloudaicompanionProject?: {
      id?: string
    }
  }
}

export type AccountTier = 'free' | 'paid'

export interface ProjectIDAndTierResult {
  projectId: string
  tier?: AccountTier
}

const CODE_ASSIST_METADATA = {
  ideType: 'IDE_UNSPECIFIED',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
} as const

function buildMetadata(projectId?: string): Record<string, string> {
  const metadata: Record<string, string> = {
    ideType: CODE_ASSIST_METADATA.ideType,
    platform: CODE_ASSIST_METADATA.platform,
    pluginType: CODE_ASSIST_METADATA.pluginType,
  }
  if (projectId) {
    metadata.duetProject = projectId
  }
  return metadata
}

/**
 * Determine account tier from allowedTiers API response
 */
function determineTierFromAllowedTiers(
  allowedTiers: Array<{ id: string; name?: string }> | undefined
): AccountTier | undefined {
  if (!allowedTiers || allowedTiers.length === 0) {
    return undefined
  }

  const firstTier = allowedTiers[0]
  if (!firstTier) {
    return undefined
  }

  const tierId = firstTier.id.toLowerCase()

  if (tierId === 'legacy-tier' || tierId.endsWith('-free')) {
    return 'free'
  }

  return 'paid'
}

export async function fetchAntigravityProjectID(accessToken: string): Promise<string> {
  const result = await fetchAntigravityProjectIDAndTier(accessToken)
  return result.projectId
}

export async function loadManagedProject(
  accessToken: string,
  projectId?: string
): Promise<LoadCodeAssistResponse | null> {
  const metadata = buildMetadata(projectId)
  const requestBody = { metadata }

  const loadHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'google-api-nodejs-client/9.15.1',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': ANTIGRAVITY_HEADERS['Client-Metadata'],
  }

  const loadEndpoints = Array.from(
    new Set<string>([...ANTIGRAVITY_LOAD_ENDPOINTS, ...ANTIGRAVITY_ENDPOINT_FALLBACKS])
  )

  for (const baseEndpoint of loadEndpoints) {
    try {
      const response = await fetch(`${baseEndpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: loadHeaders,
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        continue
      }

      return (await response.json()) as LoadCodeAssistResponse
    } catch {
      // ignore
    }
  }

  return null
}

export async function onboardManagedProject(
  accessToken: string,
  tierId: string,
  projectId?: string
): Promise<string | undefined> {
  const metadata = buildMetadata(projectId)
  const requestBody: Record<string, unknown> = {
    tierId,
    metadata,
  }

  if (tierId !== 'FREE' && projectId) {
    requestBody.cloudaicompanionProject = projectId
  }

  // Use a subset of endpoints or just one for onboarding? opencode uses FALLBACKS
  for (const baseEndpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
    try {
      const response = await fetch(`${baseEndpoint}/v1internal:onboardUser`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...ANTIGRAVITY_HEADERS,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        continue
      }

      const payload = (await response.json()) as OnboardUserPayload
      const managedProjectId = payload.response?.cloudaicompanionProject?.id
      if (payload.done && managedProjectId) {
        return managedProjectId
      }
      if (payload.done && projectId) {
        return projectId
      }
    } catch {
      // ignore
    }
  }
  return undefined
}

export async function fetchAntigravityProjectIDAndTier(
  accessToken: string
): Promise<ProjectIDAndTierResult> {
  if (projectContextResultCache.has(accessToken)) {
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by .has() check
    return projectContextResultCache.get(accessToken)!
  }

  const data = await loadManagedProject(accessToken)

  if (!data) {
    return { projectId: '', tier: undefined }
  }

  let projectId = ''
  if (typeof data.cloudaicompanionProject === 'string' && data.cloudaicompanionProject) {
    projectId = data.cloudaicompanionProject
  } else if (
    data.cloudaicompanionProject &&
    typeof data.cloudaicompanionProject === 'object' &&
    typeof data.cloudaicompanionProject.id === 'string' &&
    data.cloudaicompanionProject.id
  ) {
    projectId = data.cloudaicompanionProject.id
  }

  const tier = determineTierFromAllowedTiers(data.allowedTiers)

  const result = { projectId, tier }
  projectContextResultCache.set(accessToken, result)

  return result
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
        let accountTier: AccountTier | undefined
        if (!effectiveProjectId) {
          try {
            const result = await fetchAntigravityProjectIDAndTier(tokenPayload.access_token)
            effectiveProjectId = result.projectId
            accountTier = result.tier
          } catch {
            // ignore
          }
        }

        if (!effectiveProjectId) {
          effectiveProjectId = ''
        }

        const credential: OAuthCredential = {
          type: 'oauth',
          accessToken: tokenPayload.access_token,
          refreshToken: refreshToken,
          expiresAt: Date.now() + tokenPayload.expires_in * 1000,
          email: userInfo.email,
          projectId: effectiveProjectId,
          ...(accountTier && { metadata: { tier: accountTier } }),
        }

        return {
          type: 'success',
          credential,
        }
      } catch (error) {
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
  // Support 3 parts: refresh | projectId | managedProjectId
  const parts = (currentCredential.refreshToken || '').split('|')
  const refreshToken = parts[0]
  const projectId = parts[1] || ''
  const managedProjectId = parts[2] || ''

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
  const newRefreshToken = tokenPayload.refresh_token || refreshToken

  // Re-resolve or preserve project ID
  let effectiveProjectId = currentCredential.projectId || projectId
  const effectiveManagedId = managedProjectId

  let accountTier: AccountTier | undefined
  if (
    currentCredential.metadata &&
    typeof currentCredential.metadata === 'object' &&
    'tier' in currentCredential.metadata
  ) {
    accountTier = currentCredential.metadata.tier as AccountTier
  }

  // If we have no effective project id or if we want to re-verify occasionally...
  // For now, let's allow it to be resolved if missing.
  if (!effectiveProjectId) {
    try {
      const result = await fetchAntigravityProjectIDAndTier(tokenPayload.access_token)
      effectiveProjectId = result.projectId
      accountTier = result.tier
    } catch {
      // ignore
    }
  }

  if (!effectiveProjectId) {
    effectiveProjectId = ''
  }

  // Construct stored refresh token with up to 3 parts
  // refreshToken|projectId|managedProjectId
  // Only include managedProjectId if it exists
  let storedRefresh = `${newRefreshToken}|${effectiveProjectId}`
  if (effectiveManagedId) {
    storedRefresh += `|${effectiveManagedId}`
  }

  return {
    ...currentCredential,
    accessToken: tokenPayload.access_token,
    refreshToken: storedRefresh,
    expiresAt: Date.now() + tokenPayload.expires_in * 1000,
    projectId: effectiveProjectId,
    ...(accountTier && { metadata: { tier: accountTier } }),
  }
}
