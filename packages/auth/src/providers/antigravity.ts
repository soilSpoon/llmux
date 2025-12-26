import { CredentialStorage } from '../storage'
import type { Credential } from '../types'
import { isApiKeyCredential, isOAuthCredential } from '../types'
import { ANTIGRAVITY_ENDPOINT_PROD, ANTIGRAVITY_HEADERS } from './antigravity-constants'
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
    if (isApiKeyCredential(credential)) {
      return {
        'x-goog-api-key': credential.key,
        'Content-Type': 'application/json',
      }
    }

    if (isOAuthCredential(credential)) {
      return {
        Authorization: `Bearer ${credential.accessToken}`,
        'Content-Type': 'application/json',
      }
    }

    return {}
  },

  getEndpoint(model: string): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
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
