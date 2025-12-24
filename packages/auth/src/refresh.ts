import { CredentialStorage } from './storage'
import type { Credential, OAuthCredential, ProviderID } from './types'
import { isApiKeyCredential, isOAuthCredential } from './types'

const DEFAULT_BUFFER_MS = 5 * 60 * 1000

export namespace TokenRefresh {
  export function isExpired(credential: OAuthCredential): boolean {
    return credential.expiresAt <= Date.now()
  }

  export function shouldRefresh(
    credential: OAuthCredential,
    bufferMs: number = DEFAULT_BUFFER_MS
  ): boolean {
    return credential.expiresAt - bufferMs <= Date.now()
  }

  export async function ensureFresh(provider: ProviderID): Promise<Credential> {
    const credential = await CredentialStorage.get(provider)
    if (!credential) {
      throw new Error(`No credential found for provider: ${provider}`)
    }

    if (isApiKeyCredential(credential)) {
      return credential
    }

    if (isOAuthCredential(credential)) {
      if (!shouldRefresh(credential)) {
        return credential
      }
      throw new Error(`Token refresh not implemented for provider: ${provider}`)
    }

    return credential
  }
}
