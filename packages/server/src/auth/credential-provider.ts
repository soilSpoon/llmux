import type { Credential, OAuthCredential, ProviderID } from '@llmux/auth'
import { CredentialStorage, isOAuthCredential } from '@llmux/auth'

export interface CredentialProvider {
  getCredential(provider: ProviderID): Promise<Credential | null>
  getAccessToken(provider: ProviderID): Promise<string | null>
  getAllCredentials(): Promise<Record<string, Credential[]>>
}

export function createCredentialProvider(): CredentialProvider {
  return {
    async getCredential(provider: ProviderID): Promise<Credential | null> {
      const credentials = await CredentialStorage.get(provider)
      if (credentials.length === 0) {
        return null
      }
      return credentials[0] ?? null
    },

    async getAccessToken(provider: ProviderID): Promise<string | null> {
      const credential = await this.getCredential(provider)
      if (!credential) {
        return null
      }

      if (isOAuthCredential(credential)) {
        return credential.accessToken
      }

      if ('key' in credential) {
        return credential.key
      }

      return null
    },

    async getAllCredentials(): Promise<Record<string, Credential[]>> {
      return CredentialStorage.all()
    },
  }
}

export type { Credential, OAuthCredential, ProviderID }
