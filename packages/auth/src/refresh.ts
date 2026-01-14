import { AuthProviderRegistry } from './providers/registry'
import { CredentialStorage } from './storage'
import type { Credential, OAuthCredential } from './types'
import { isApiKeyCredential, isOAuthCredential } from './types'

const DEFAULT_BUFFER_MS = 5 * 60 * 1000

const pendingRefreshes = new Map<string, Promise<Credential[]>>()

export namespace TokenRefresh {
  export function clearPending(): void {
    pendingRefreshes.clear()
  }

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
    const effectiveProviderId = providerId === 'gemini-cli' ? 'antigravity' : providerId

    const existing = pendingRefreshes.get(effectiveProviderId)
    if (existing) {
      return existing
    }

    const refreshPromise = (async () => {
      const credentials = await CredentialStorage.get(effectiveProviderId)
      if (!credentials || credentials.length === 0) {
        throw new Error(`No credentials available for provider: ${providerId}`)
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

          const provider = AuthProviderRegistry.get(effectiveProviderId)

          if (provider?.refresh) {
            try {
              const refreshed = await provider.refresh(credential)
              updatedCredentials.push(refreshed)
              hasUpdates = true
            } catch {
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
        await CredentialStorage.setAll(effectiveProviderId, updatedCredentials)
      }

      return updatedCredentials
    })()

    pendingRefreshes.set(effectiveProviderId, refreshPromise)
    try {
      return await refreshPromise
    } finally {
      pendingRefreshes.delete(effectiveProviderId)
    }
  }
}
