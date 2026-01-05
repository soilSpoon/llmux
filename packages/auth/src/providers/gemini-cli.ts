import { CredentialStorage } from '../storage'
import { isOAuthCredential } from '../types'
import {
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  GEMINI_CLI_API_PATH,
  GEMINI_CLI_API_PATH_STREAM,
  GEMINI_CLI_HEADERS,
} from './antigravity-constants'
import { fetchAntigravityProjectID, refreshAntigravityToken } from './antigravity-oauth'

const PROVIDER_ID = 'antigravity'

const GEMINI_CLI_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
])

export function isGeminiCliModel(model: string | undefined): boolean {
  return !!model && GEMINI_CLI_MODELS.has(model)
}

export interface GeminiCliRequestContext {
  headers: Record<string, string>
  endpoint: string
  projectId: string
  accountIndex: number
  account: string
}

export async function prepareGeminiCliRequest(options: {
  model: string
  accountIndex?: number
  endpointIndex?: number
  streaming?: boolean
}): Promise<GeminiCliRequestContext | null> {
  const credentials = await CredentialStorage.get(PROVIDER_ID)
  if (credentials.length === 0) return null

  const accountIndex = options.accountIndex ?? 0
  const endpointIndex = options.endpointIndex ?? 0
  const credentialOrUndefined = credentials[accountIndex % credentials.length]

  if (!credentialOrUndefined || !isOAuthCredential(credentialOrUndefined)) return null

  let credential = credentialOrUndefined
  let accessToken = credential.accessToken
  let projectId = credential.projectId || ''

  if (credential.expiresAt && Date.now() >= credential.expiresAt - 60000) {
    const refreshed = await refreshAntigravityToken(credential)
    accessToken = refreshed.accessToken
    projectId = refreshed.projectId || ''
    credential = refreshed
    await CredentialStorage.update(PROVIDER_ID, refreshed)
  }

  if (!projectId) {
    projectId = await fetchAntigravityProjectID(accessToken)
  }

  const apiPath = options.streaming ? GEMINI_CLI_API_PATH_STREAM : GEMINI_CLI_API_PATH
  const baseEndpoint =
    ANTIGRAVITY_ENDPOINT_FALLBACKS[endpointIndex % ANTIGRAVITY_ENDPOINT_FALLBACKS.length]
  const endpoint = `${baseEndpoint}${apiPath}`

  const headers: Record<string, string> = {
    ...GEMINI_CLI_HEADERS,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }

  // NOTE: Do NOT set x-goog-user-project header for gemini-cli
  // This header causes 403 errors if the Cloud Code Private API is not enabled in the project
  // The project ID is already included in the request body, which is sufficient for Antigravity API

  return {
    headers,
    endpoint,
    projectId,
    accountIndex,
    account: credential.email || `account-${accountIndex}`,
  }
}
