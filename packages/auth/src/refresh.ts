import { AuthProviderRegistry } from './providers/registry'
import { CredentialStorage } from './storage'
import type { Credential, OAuthCredential } from './types'
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

  export async function ensureFresh(providerId: string): Promise<Credential[]> {
    const credentials = await CredentialStorage.get(providerId)
    if (!credentials || credentials.length === 0) {
      throw new Error(`No credentials found for provider: ${providerId}`)
    }

    const updatedCredentials: Credential[] = []
    let hasUpdates = false

    for (const credential of credentials) {
      if (isApiKeyCredential(credential)) {
        updatedCredentials.push(credential)
        continue
      }

      if (isOAuthCredential(credential)) {
        if (!shouldRefresh(credential)) {
          updatedCredentials.push(credential)
          continue
        }

        const provider = AuthProviderRegistry.get(providerId)

        if (provider?.refresh) {
          try {
            const refreshed = await provider.refresh(credential)
            updatedCredentials.push(refreshed)
            hasUpdates = true
          } catch (e) {
            // If refresh fails, keep old one? Or remove?
            // Keeping old allows retry or manual intervention.
            updatedCredentials.push(credential)
          }
        } else {
          updatedCredentials.push(credential)
        }
      } else {
        updatedCredentials.push(credential)
      }
    }

    if (hasUpdates) {
      // We need to save all back.
      // CredentialStorage.set/add works per item or list?
      // Storage set is deprecated/removed in favor of add/update.
      // I need a way to replace the list.
      // I added setAll? No, I implemented set/add/update which are singular.
      // I need `setAll` in storage.ts or loop update.

      // I will loop update for now as `add` handles update by key matching.
      for (const cred of updatedCredentials) {
        await CredentialStorage.update(providerId, cred)
      }
    }

    return updatedCredentials
  }
}
