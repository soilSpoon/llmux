import type { ProviderID } from '../types'
import type { AuthProvider } from './base'

const providers = new Map<string, AuthProvider>()

export namespace AuthProviderRegistry {
  export function register(provider: AuthProvider): void {
    providers.set(provider.id, provider)
  }

  export function unregister(id: ProviderID): void {
    providers.delete(id)
  }

  export function get(id: ProviderID): AuthProvider | undefined {
    return providers.get(id)
  }

  export function list(): AuthProvider[] {
    return Array.from(providers.values())
  }

  export function clear(): void {
    providers.clear()
  }
}
