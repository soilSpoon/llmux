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
  account: string
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

  let projectId: string
  if (overrideProjectId) {
    projectId = overrideProjectId
    logger.debugTemp({ reqId, projectId, reason: 'override' }, 'Using override projectId')
  } else {
    const storedProjectId = cred.projectId
    logger.debug(
      { reqId, storedProjectId, credKeys: Object.keys(cred) },
      'Checking stored projectId'
    )
    projectId = storedProjectId || (await fetchAntigravityProjectID(cred.accessToken as string))
    logger.debugTemp(
      { reqId, projectId, storedProjectId, source: storedProjectId ? 'stored' : 'fetched' },
      'Resolved projectId for Antigravity'
    )
  }

  // Rotate endpoints: use Daily (0) or Prod (1) based on account index
  // This distributes load and provides fallback in case one endpoint is rate-limited
  const endpointIndex = resolvedAccountIndex % 2
  const baseUrl = ANTIGRAVITY_ENDPOINT_FALLBACKS[endpointIndex]
  const endpoint = `${baseUrl}${ANTIGRAVITY_API_PATH_STREAM}`

  logger.debug(
    { reqId, accountIndex: resolvedAccountIndex, endpointIndex, endpoint },
    'Selected endpoint for account rotation'
  )

  return {
    headers,
    endpoint,
    projectId,
    accountIndex: resolvedAccountIndex,
    credentials,
    account: currentEmail,
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

export function processAntigravitySystemInstruction(
  payload: Record<string, unknown>
): Record<string, unknown> {
  try {
    const data = { ...payload }
    const modelName = (data.model as string) || ''

    // Parity check: Go project only applies this for Claude or Gemini 3 Pro Preview
    if (
      !modelName.toLowerCase().includes('claude') &&
      !modelName.toLowerCase().includes('gemini-3-pro-preview')
    ) {
      return data
    }

    if (!data.request || typeof data.request !== 'object') {
      data.request = {}
    }
    const request = data.request as Record<string, unknown>

    if (!request.systemInstruction || typeof request.systemInstruction !== 'object') {
      request.systemInstruction = {}
    }
    const systemInstruction = request.systemInstruction as Record<string, unknown>

    // Store existing parts before modification
    const existingParts = Array.isArray(systemInstruction.parts)
      ? (systemInstruction.parts as unknown[])
      : []

    // Set role to 'user'
    systemInstruction.role = 'user'

    // System instruction text (exactly as in Go project)
    const SYSTEM_INSTRUCTION_TEXT =
      'You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**'

    // Parity with Go project:
    // parts[0] = systemInstruction
    // parts[1] = "Please ignore following [ignore]" + systemInstruction + "[/ignore]"
    // then append existing parts
    systemInstruction.parts = [
      { text: SYSTEM_INSTRUCTION_TEXT },
      { text: `Please ignore following [ignore]${SYSTEM_INSTRUCTION_TEXT}[/ignore]` },
    ]

    // Append existing parts
    if (existingParts.length > 0) {
      systemInstruction.parts = [...(systemInstruction.parts as unknown[]), ...existingParts]
    }

    return data
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to process system instruction, returning original payload'
    )
    return payload
  }
}

export { ANTIGRAVITY_DEFAULT_PROJECT_ID }
