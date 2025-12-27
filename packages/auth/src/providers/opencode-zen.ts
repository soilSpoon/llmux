import { CredentialStorage } from '../storage'
import type { ApiKeyCredential, Credential } from '../types'
import { isApiKeyCredential, isOAuthCredential } from '../types'
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
    // Actually, we should probably fetch 'opencode-zen' credentials
    // But since I don't have a way to input them right now in the CLI easily without a prompt,
    // and the user didn't specify where the key comes from.
    // Assuming for now developers might default to "dummy" or have set it.
    // Wait, the previous code I SAW had apiKeyMethod.
    const credentials = await CredentialStorage.get(PROVIDER_ID)
    if (credentials.length === 0) return undefined
    return credentials[0]
  },

  async getHeaders(credential: Credential): Promise<Record<string, string>> {
    console.log('[OpencodeZen] Getting headers for credential type:', credential.type)
    const baseHeaders = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01', // Required for Anthropic-compatible endpoints
    }

    if (isApiKeyCredential(credential)) {
      return {
        ...baseHeaders,
        'x-api-key': credential.key, // Use x-api-key for Anthropic format
      }
    }

    // Fallback if somehow oauth credential is used (though methods say api only)
    if (isOAuthCredential(credential)) {
      return {
        ...baseHeaders,
        'x-api-key': credential.accessToken,
      }
    }

    return baseHeaders
  },

  getEndpoint(_model: string): string {
    // Determine endpoint based on model family

    // Responses API (GPT-5 series)
    if (_model.startsWith('gpt-5')) {
      return 'https://opencode.ai/zen/v1/responses'
    }

    // Anthropic-compatible models (v1/messages)
    // Claude series only
    if (_model.includes('claude')) {
      return 'https://opencode.ai/zen/v1/messages'
    }

    // Google-compatible models (v1/models/...)
    if (_model.startsWith('gemini-3')) {
      return `https://opencode.ai/zen/v1/models/${_model}`
    }

    // Default to chat completions (GLM 4.6, GLM 4.7, Kimi, Qwen, Grok, Big Pickle)
    return 'https://opencode.ai/zen/v1/chat/completions'
  },
}
