import { describe, it, expect, beforeEach } from 'bun:test'
import { TokenRefresh } from '../src/refresh'
import { CredentialStorage } from '../src/storage'
import { AuthProviderRegistry } from '../src/providers/registry'
import type { OAuthCredential, Credential } from '../src/types'
import { unlink } from 'node:fs/promises'

describe('Concurrent Refresh', () => {
  const providerId = 'concurrent-test'
  
  beforeEach(async () => {
    try {
      await unlink(CredentialStorage.getPath())
    } catch {}
    AuthProviderRegistry.clear()
  })

  it('should only call provider.refresh once when multiple requests come in concurrently', async () => {
    const mockCred: OAuthCredential = {
      type: 'oauth',
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
    }

    await CredentialStorage.add(providerId, mockCred)

    let refreshCount = 0
    const mockProvider = {
      id: providerId,
      name: 'Test Provider',
      methods: [],
      async getCredential() { return mockCred },
      async getHeaders() { return {} },
      getEndpoint() { return '' },
      async refresh(cred: Credential) {
        refreshCount++
        await new Promise(resolve => setTimeout(resolve, 50))
        return { 
          ...cred, 
          accessToken: 'new-token', 
          expiresAt: Date.now() + 3600000 
        } as OAuthCredential
      }
    }

    AuthProviderRegistry.register(mockProvider as any)

    const results = await Promise.all([
      TokenRefresh.ensureFresh(providerId),
      TokenRefresh.ensureFresh(providerId),
      TokenRefresh.ensureFresh(providerId),
    ])

    expect(refreshCount).toBe(1)
    
    for (const result of results) {
      expect((result[0] as OAuthCredential).accessToken).toBe('new-token')
    }

    const stored = await CredentialStorage.get(providerId)
    expect((stored[0] as OAuthCredential).accessToken).toBe('new-token')
  })
})
