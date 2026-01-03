import { type Credential, isOAuthCredential, type OAuthCredential, TokenRefresh } from '@llmux/auth'
import { createLogger } from '@llmux/core'
import { accountRotationManager } from '../handlers/account-rotation'
import { getCodexInstructions } from '../handlers/codex'

const logger = createLogger({ service: 'provider-openai-web' })

const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'

export interface OpenAIWebRequestContext {
  headers: Record<string, string>
  endpoint: string
  accountIndex: number
  credentials: Credential[]
}

export interface PrepareOpenAIWebRequestOptions {
  model: string
  accountIndex: number
  reqId?: string
}

export async function prepareOpenAIWebRequest(
  options: PrepareOpenAIWebRequestOptions
): Promise<OpenAIWebRequestContext | null> {
  const { reqId } = options

  let credentials: Credential[]
  try {
    credentials = await TokenRefresh.ensureFresh('openai-web')
  } catch (error) {
    logger.error({ reqId, error }, 'Failed to refresh OpenAI Web tokens')
    return null
  }

  if (!credentials || credentials.length === 0) {
    logger.warn({ reqId }, 'No credentials available for OpenAI Web')
    return null
  }

  const resolvedAccountIndex = accountRotationManager.getNextAvailable(
    'openai-web',
    options.model,
    credentials
  )
  const selectedCred = credentials[resolvedAccountIndex]

  if (!selectedCred || !isOAuthCredential(selectedCred)) {
    logger.warn({ reqId }, 'Selected credential is not OAuth credential')
    return null
  }

  const cred = selectedCred as OAuthCredential & { accountId?: string }
  const currentEmail = cred.email || 'unknown'
  logger.info(
    { reqId, email: currentEmail, accountIndex: resolvedAccountIndex },
    'Using OpenAI Web account for rotation'
  )

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${cred.accessToken}`,
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
  }

  if (cred.accountId) {
    headers['chatgpt-account-id'] = cred.accountId
  }

  return {
    headers,
    endpoint: CODEX_ENDPOINT,
    accountIndex: resolvedAccountIndex,
    credentials,
  }
}

export function transformToolsForCodex(
  tools: Array<{
    type?: string
    name?: string
    description?: string
    parameters?: unknown
    input_schema?: unknown
    function?: {
      name?: string
      description?: string
      parameters?: unknown
    }
  }>
): Array<{
  type: string
  name: string
  description?: string
  parameters?: unknown
}> {
  logger.debug({ toolsCount: tools.length }, '[tools] Starting transformToolsForCodex')

  return tools.map((tool, idx) => {
    let transformed: {
      type: string
      name: string
      description?: string
      parameters?: unknown
    }

    if (tool.function?.name) {
      transformed = {
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      }
      logger.debug(
        {
          index: idx,
          originalFormat: 'ChatCompletion',
          name: tool.function.name,
        },
        '[tools] Transformed from ChatCompletion format'
      )
      return transformed
    }

    if (tool.name && tool.input_schema) {
      transformed = {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      }
      logger.debug(
        { index: idx, originalFormat: 'Anthropic', name: tool.name },
        '[tools] Transformed from Anthropic format'
      )
      return transformed
    }

    if (tool.name) {
      transformed = {
        type: tool.type || 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }
      logger.debug(
        { index: idx, originalFormat: 'Responses API', name: tool.name },
        '[tools] Already in Responses API format'
      )
      return transformed
    }

    transformed = {
      type: tool.type || 'function',
      name: tool.name || 'unknown',
      description: tool.description,
      parameters: tool.parameters || tool.input_schema,
    }
    logger.warn(
      { index: idx, originalTool: JSON.stringify(tool).slice(0, 100) },
      '[tools] Using fallback transformation (missing name)'
    )
    return transformed
  })
}

export interface CodexBodyOptions {
  model: string
  messages: unknown
  tools?: Array<{
    type?: string
    name?: string
    description?: string
    parameters?: unknown
    input_schema?: unknown
    function?: {
      name?: string
      description?: string
      parameters?: unknown
    }
  }>
  reasoning?: unknown
  systemInstructions?: string
}

export async function buildCodexBody(options: CodexBodyOptions): Promise<Record<string, unknown>> {
  const instructions = options.systemInstructions || (await getCodexInstructions(options.model))

  const transformedTools = options.tools ? transformToolsForCodex(options.tools) : undefined

  const codexBody: Record<string, unknown> = {
    model: options.model,
    instructions,
    input: options.messages,
    store: false,
    stream: true,
  }

  if (transformedTools && transformedTools.length > 0) {
    codexBody.tools = transformedTools
  }

  if (options.reasoning) {
    codexBody.reasoning = options.reasoning
  }

  logger.info(
    {
      model: options.model,
      hasInstructions: !!instructions,
      toolsCount: transformedTools?.length ?? 0,
    },
    '[openai-web] Codex body constructed'
  )

  return codexBody
}

export { getCodexInstructions }
