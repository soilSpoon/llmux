import { CredentialStorage } from '../storage'
import type { ApiKeyCredential, Credential } from '../types'
import { isApiKeyCredential } from '../types'
import type { AuthMethod, AuthProvider, AuthResult } from './base'

const PROVIDER_ID = 'opencode-zen'

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

export const OpencodeZenProvider: AuthProvider = {
  id: PROVIDER_ID,
  name: 'Opencode Zen',
  methods: [apiKeyMethod],

  async getCredential(): Promise<Credential | undefined> {
    const credentials = await CredentialStorage.get(PROVIDER_ID)
    return credentials[0]
  },

  async getHeaders(credential: Credential): Promise<Record<string, string>> {
    if (!isApiKeyCredential(credential)) {
      return {}
    }
    return { Authorization: `Bearer ${credential.key}` }
  },

  getEndpoint(_model: string): string {
    return 'https://opencode.ai/api/v1/chat/completions'
  },
}
