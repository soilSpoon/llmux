import {
  createAuthorizationFlow,
  decodeJWT,
  exchangeAuthorizationCode,
  parseAuthorizationInput,
  refreshAccessToken,
} from '../codex/oauth'
import { CredentialStorage } from '../storage'
import type { Credential, OAuthCredential } from '../types'
import { isOAuthCredential } from '../types'
import type { AuthIntermediate, AuthMethod, AuthProvider, AuthResult } from './base'
import { startOpenAIOAuthListener } from './openai-server'

// Re-export for openai-server.ts
export { REDIRECT_URI } from '../codex/oauth'

const PROVIDER_ID = 'openai-web'
const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'

// Codex-specific headers
const CODEX_HEADERS = {
  BETA: 'OpenAI-Beta',
  ACCOUNT_ID: 'chatgpt-account-id',
  ORIGINATOR: 'originator',
  SESSION_ID: 'session_id',
  CONVERSATION_ID: 'conversation_id',
} as const

const CODEX_HEADER_VALUES = {
  BETA_RESPONSES: 'responses=experimental',
  ORIGINATOR_CODEX: 'codex_cli_rs',
} as const

let authFlowState: {
  pkceVerifier: string
  state: string
} | null = null

const oauthMethod: AuthMethod = {
  type: 'oauth',
  label: 'ChatGPT Plus/Pro (Web Login)',
  authorize: async (): Promise<AuthIntermediate> => {
    const flow = await createAuthorizationFlow()

    authFlowState = {
      pkceVerifier: flow.pkce.verifier,
      state: flow.state,
    }

    const listener = await startOpenAIOAuthListener()

    return {
      type: 'intermediate',
      url: flow.url,
      message: 'Please complete the login in your browser',
      auto: true,
      callback: async (input?: string): Promise<AuthResult> => {
        try {
          let code: string | undefined
          let state: string | undefined

          if (input) {
            const parsed = parseAuthorizationInput(input)
            code = parsed.code
            state = parsed.state
          } else {
            const callbackUrl = await listener.waitForCallback()
            code = callbackUrl.searchParams.get('code') ?? undefined
            state = callbackUrl.searchParams.get('state') ?? undefined
          }

          if (!code) {
            return { type: 'failed', error: 'No authorization code received' }
          }

          if (state && authFlowState?.state && state !== authFlowState.state) {
            return { type: 'failed', error: 'State mismatch' }
          }

          if (!authFlowState) {
            return { type: 'failed', error: 'No auth flow in progress' }
          }

          const tokenResult = await exchangeAuthorizationCode(code, authFlowState.pkceVerifier)

          if (tokenResult.type === 'failed') {
            return { type: 'failed', error: `Token exchange failed: ${tokenResult.error}` }
          }

          // id_token contains user info (email, etc.)
          // access_token contains account info (sub = chatgpt_account_id)
          const idTokenPayload = tokenResult.idToken ? decodeJWT(tokenResult.idToken) : null
          const accessPayload = decodeJWT(tokenResult.access)

          // Extract email from id_token (preferred) or access_token
          const email = (idTokenPayload?.email ?? accessPayload?.email) as string | undefined

          // Extract accountId from access_token's auth claim or sub
          const authClaim = accessPayload?.['https://api.openai.com/auth'] as
            | Record<string, unknown>
            | undefined
          const accountId = (authClaim?.chatgpt_account_id ?? accessPayload?.sub) as
            | string
            | undefined

          const credential: OAuthCredential = {
            type: 'oauth',
            accessToken: tokenResult.access,
            refreshToken: tokenResult.refresh,
            expiresAt: tokenResult.expires,
            accountId,
            email,
            idToken: tokenResult.idToken,
            lastRefresh: new Date().toISOString(),
          }

          await CredentialStorage.set(PROVIDER_ID, credential)
          authFlowState = null

          return { type: 'success', credential }
        } catch (error) {
          authFlowState = null
          return {
            type: 'failed',
            error: error instanceof Error ? error.message : String(error),
          }
        } finally {
          await listener.close().catch(() => {})
        }
      },
    }
  },
}

export const OpenAIWebProvider: AuthProvider = {
  id: PROVIDER_ID,
  name: 'OpenAI (Web)',
  methods: [oauthMethod],

  async getCredential(): Promise<Credential | undefined> {
    const credentials = await CredentialStorage.get(PROVIDER_ID)
    if (credentials.length === 0) return undefined
    return credentials[0]
  },

  async getHeaders(
    credential: Credential,
    options?: { model?: string; promptCacheKey?: string }
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }

    if (isOAuthCredential(credential)) {
      headers.Authorization = `Bearer ${credential.accessToken}`

      if (credential.accountId) {
        headers[CODEX_HEADERS.ACCOUNT_ID] = credential.accountId
      }

      headers[CODEX_HEADERS.BETA] = CODEX_HEADER_VALUES.BETA_RESPONSES
      headers[CODEX_HEADERS.ORIGINATOR] = CODEX_HEADER_VALUES.ORIGINATOR_CODEX

      const cacheKey = options?.promptCacheKey
      if (cacheKey) {
        headers[CODEX_HEADERS.CONVERSATION_ID] = cacheKey
        headers[CODEX_HEADERS.SESSION_ID] = cacheKey
      }
    }

    return headers
  },

  getEndpoint(_model: string, _options?: { streaming?: boolean }): string {
    return CODEX_ENDPOINT
  },

  async refresh(credential: Credential): Promise<Credential> {
    if (!isOAuthCredential(credential)) {
      return credential
    }

    const result = await refreshAccessToken(credential.refreshToken)

    if (result.type === 'failed') {
      throw new Error(`Token refresh failed: ${result.error}`)
    }

    const newCredential: OAuthCredential = {
      ...credential,
      accessToken: result.access,
      refreshToken: result.refresh,
      expiresAt: result.expires,
      lastRefresh: new Date().toISOString(),
    }

    await CredentialStorage.set(PROVIDER_ID, newCredential)
    return newCredential
  },
}
