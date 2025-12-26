import type { Credential, ProviderID } from '../types'

export interface EndpointOptions {
  streaming?: boolean
}

export interface AuthProvider {
  id: ProviderID
  name: string
  methods: AuthMethod[]
  getCredential(): Promise<Credential | undefined>
  getHeaders(credential: Credential): Promise<Record<string, string>>
  getEndpoint(model: string, options?: EndpointOptions): string
  refresh?(credential: Credential): Promise<Credential>
  rotate?(): void
}

export interface AuthMethod {
  type: 'oauth' | 'api' | 'device-flow'
  label: string
  authorize(inputs?: Record<string, string>): Promise<AuthStep>
}

export type AuthStep = AuthResult | AuthIntermediate

export interface AuthIntermediate {
  type: 'intermediate'
  url?: string
  message?: string
  auto?: boolean
  callback(input?: string): Promise<AuthResult>
}

export interface AuthResult {
  type: 'success' | 'failed'
  credential?: Credential
  error?: string
}
