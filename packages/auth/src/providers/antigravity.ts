import { CredentialStorage } from '../storage'
import type { Credential } from '../types'
import { isApiKeyCredential, isOAuthCredential } from '../types'
import {
  ANTIGRAVITY_API_PATH_GENERATE,
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_HEADERS,
} from './antigravity-constants'
import { authorizeAntigravity, refreshAntigravityToken } from './antigravity-oauth'
import type { AuthMethod, AuthProvider } from './base'

const PROVIDER_ID = 'antigravity'
let activeIndex = 0

const oauthMethod: AuthMethod = {
  type: 'oauth',
  label: 'Google OAuth',
  authorize: () => authorizeAntigravity(),
}

export const AntigravityProvider: AuthProvider = {
  id: PROVIDER_ID,
  name: 'Antigravity (Gemini)',
  methods: [oauthMethod],

  async getCredential(): Promise<Credential | undefined> {
    const credentials = await CredentialStorage.get(PROVIDER_ID)
    if (credentials.length === 0) return undefined
    return credentials[activeIndex % credentials.length]
  },

  async getHeaders(credential: Credential): Promise<Record<string, string>> {
    const baseHeaders = {
      ...ANTIGRAVITY_HEADERS,
      'Content-Type': 'application/json',
    }

    if (isApiKeyCredential(credential)) {
      return {
        ...baseHeaders,
        'x-goog-api-key': credential.key,
      }
    }

    if (isOAuthCredential(credential)) {
      return {
        ...baseHeaders,
        Authorization: `Bearer ${credential.accessToken}`,
      }
    }

    return baseHeaders
  },

  getEndpoint(_model: string, options?: { streaming?: boolean }): string {
    const path = options?.streaming ? ANTIGRAVITY_API_PATH_STREAM : ANTIGRAVITY_API_PATH_GENERATE
    return `${ANTIGRAVITY_ENDPOINT_DAILY}${path}`
  },

  async refresh(credential: Credential): Promise<Credential> {
    if (isOAuthCredential(credential)) {
      return refreshAntigravityToken(credential)
    }
    return credential
  },

  rotate() {
    activeIndex++
  },
}
