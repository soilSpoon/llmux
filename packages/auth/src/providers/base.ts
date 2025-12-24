import type { Credential, ProviderID } from '../types'

export interface AuthProvider {
  id: ProviderID
  name: string
  methods: AuthMethod[]
  getCredential(): Promise<Credential | undefined>
  getHeaders(): Promise<Record<string, string>>
  getEndpoint(model: string): string
}

export interface AuthMethod {
  type: 'oauth' | 'api' | 'device-flow'
  label: string
  authorize(inputs?: Record<string, string>): Promise<AuthResult>
}

export interface AuthResult {
  type: 'success' | 'failed'
  credential?: Credential
  error?: string
}
