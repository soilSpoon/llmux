import { describe, expect, test, beforeEach } from 'bun:test'
import { AuthProviderRegistry } from '../../src/providers/registry'
import type { AuthProvider, AuthMethod, AuthResult } from '../../src/providers/base'

const mockProvider: AuthProvider = {
  id: 'test-provider',
  name: 'Test Provider',
  methods: [
    {
      type: 'api',
      label: 'API Key',
      authorize: async () => ({ type: 'success', credential: { type: 'api', key: 'test' } }),
    },
  ],
  getCredential: async () => undefined,
  getHeaders: async () => ({ 'Authorization': 'Bearer test' }),
  getEndpoint: () => 'https://api.example.com/v1/chat',
}

describe('AuthProviderRegistry', () => {
  beforeEach(() => {
    AuthProviderRegistry.clear()
  })

  test('register and get provider', () => {
    AuthProviderRegistry.register(mockProvider)
    const provider = AuthProviderRegistry.get('test-provider')
    expect(provider).toBe(mockProvider)
  })

  test('get returns undefined for unknown provider', () => {
    const provider = AuthProviderRegistry.get('unknown')
    expect(provider).toBeUndefined()
  })

  test('list returns all registered providers', () => {
    const provider2: AuthProvider = {
      ...mockProvider,
      id: 'test-provider-2',
      name: 'Test Provider 2',
    }
    AuthProviderRegistry.register(mockProvider)
    AuthProviderRegistry.register(provider2)
    const providers = AuthProviderRegistry.list()
    expect(providers.length).toBe(2)
    expect(providers.map(p => p.id)).toContain('test-provider')
    expect(providers.map(p => p.id)).toContain('test-provider-2')
  })

  test('register overwrites existing provider with same id', () => {
    const updated: AuthProvider = { ...mockProvider, name: 'Updated Provider' }
    AuthProviderRegistry.register(mockProvider)
    AuthProviderRegistry.register(updated)
    const provider = AuthProviderRegistry.get('test-provider')
    expect(provider?.name).toBe('Updated Provider')
    expect(AuthProviderRegistry.list().length).toBe(1)
  })
})

describe('AuthProvider interface', () => {
  test('provider has required properties', () => {
    expect(mockProvider.id).toBe('test-provider')
    expect(mockProvider.name).toBe('Test Provider')
    expect(mockProvider.methods.length).toBeGreaterThan(0)
  })

  test('getHeaders returns header object', async () => {
    const headers = await mockProvider.getHeaders()
    expect(headers).toHaveProperty('Authorization')
  })

  test('getEndpoint returns URL string', () => {
    const endpoint = mockProvider.getEndpoint('test-model')
    expect(endpoint).toContain('https://')
  })

  test('method authorize returns AuthResult', async () => {
    const method = mockProvider.methods[0]
    const result = await method.authorize()
    expect(result.type).toBe('success')
    expect(result.credential).toBeDefined()
  })
})
