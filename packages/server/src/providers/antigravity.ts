import {
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_HEADERS,
  type Credential,
  fetchAntigravityProjectID,
  isOAuthCredential,
  type OAuthCredential,
} from '@llmux/auth'
import { createLogger } from '@llmux/core'
import { accountRotationManager } from '../handlers/account-rotation'

const logger = createLogger({ service: 'antigravity-provider' })

export interface AntigravityRequestContext {
  headers: Record<string, string>
  endpoint: string
  projectId: string
  accountIndex: number
  credentials: Credential[]
}

export interface PrepareAntigravityRequestOptions {
  model: string
  accountIndex: number
  overrideProjectId?: string | null
  streaming?: boolean
  reqId?: string
}

export async function prepareAntigravityRequest(
  options: PrepareAntigravityRequestOptions
): Promise<AntigravityRequestContext | null> {
  const { model, accountIndex, overrideProjectId, streaming = true, reqId } = options

  const result = await accountRotationManager.getCredential('antigravity', model, accountIndex)
  if (!result) {
    logger.warn({ reqId }, 'No credentials available for Antigravity')
    return null
  }

  const { credentials, accountIndex: resolvedAccountIndex } = result
  const selectedCred = credentials[resolvedAccountIndex]

  if (!selectedCred || !isOAuthCredential(selectedCred)) {
    logger.warn({ reqId }, 'Selected credential is not OAuth credential')
    return null
  }

  const cred = selectedCred as OAuthCredential & { quotaProjectId?: string; projectId?: string }
  const currentEmail = cred.email || 'unknown'
  logger.info(
    { reqId, email: currentEmail, accountIndex: resolvedAccountIndex },
    'Using account for rotation'
  )

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...ANTIGRAVITY_HEADERS,
    Authorization: `Bearer ${cred.accessToken}`,
  }

  if (streaming) {
    headers.Accept = 'text/event-stream'
  }

  if (cred.quotaProjectId) {
    headers['x-quota-project'] = cred.quotaProjectId
  }

  let projectId: string
  if (overrideProjectId) {
    projectId = overrideProjectId
  } else {
    const storedProjectId = cred.projectId
    logger.debug(
      { reqId, storedProjectId, credKeys: Object.keys(cred) },
      'Checking stored projectId'
    )
    projectId = storedProjectId || (await fetchAntigravityProjectID(cred.accessToken as string))
    logger.debug(
      { reqId, projectId, source: storedProjectId ? 'stored' : 'fetched' },
      'Resolved projectId'
    )
  }

  const endpoint = `${ANTIGRAVITY_ENDPOINT_FALLBACKS[0]}${ANTIGRAVITY_API_PATH_STREAM}`

  return {
    headers,
    endpoint,
    projectId,
    accountIndex: resolvedAccountIndex,
    credentials,
  }
}

export interface LicenseErrorContext {
  errorBody: string
  status: number
  currentProject?: string
}

export function isLicenseError(ctx: LicenseErrorContext): boolean {
  if (ctx.status !== 403 && ctx.status !== 400) return false
  return (
    ctx.errorBody.includes('#3501') ||
    (ctx.errorBody.includes('PERMISSION_DENIED') && ctx.errorBody.includes('license'))
  )
}

export function shouldFallbackToDefaultProject(
  ctx: LicenseErrorContext,
  defaultProjectId: string = ANTIGRAVITY_DEFAULT_PROJECT_ID
): boolean {
  return isLicenseError(ctx) && ctx.currentProject !== defaultProjectId
}

export { ANTIGRAVITY_DEFAULT_PROJECT_ID }
