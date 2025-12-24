import { CredentialStorage } from '../storage'
import type { ApiKeyCredential, Credential } from '../types'
import { isApiKeyCredential, isOAuthCredential } from '../types'
import type { AuthMethod, AuthProvider, AuthResult } from './base'

const PROVIDER_ID = 'antigravity'

const apiKeyMethod: AuthMethod = {
  type: 'api',
  label: 'API Key',
  async authorize(inputs?: Record<string, string>): Promise<AuthResult> {
    const key = inputs?.key
    if (!key) {
      return { type: 'failed', error: 'API key is required' }
    }
    const credential: ApiKeyCredential = { type: 'api', key }
    await CredentialStorage.set(PROVIDER_ID, credential)
    return { type: 'success', credential }
  },
}

export const AntigravityProvider: AuthProvider = {
  id: PROVIDER_ID,
  name: 'Antigravity (Gemini)',
  methods: [apiKeyMethod],

  async getCredential(): Promise<Credential | undefined> {
    return CredentialStorage.get(PROVIDER_ID)
  },

  async getHeaders(): Promise<Record<string, string>> {
    const credential = await this.getCredential()
    if (!credential) {
      return {}
    }

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
}
