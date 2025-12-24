export type AuthType = 'oauth' | 'api' | 'device-flow'
export type ProviderID = 'opencode-zen' | 'github-copilot' | 'antigravity' | string

export interface OAuthCredential {
  type: 'oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
  projectId?: string
  email?: string
}

export interface ApiKeyCredential {
  type: 'api'
  key: string
}

export type Credential = OAuthCredential | ApiKeyCredential

export function isOAuthCredential(credential: Credential): credential is OAuthCredential {
  return credential != null && typeof credential === 'object' && credential.type === 'oauth'
}

export function isApiKeyCredential(credential: Credential): credential is ApiKeyCredential {
  return credential != null && typeof credential === 'object' && credential.type === 'api'
}
