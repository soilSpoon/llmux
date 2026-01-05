import {
  ANTIGRAVITY_API_PATH_GENERATE,
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  AuthProviderRegistry,
  prepareGeminiCliRequest,
  TokenRefresh,
} from '@llmux/auth'
import type { ProviderName } from '@llmux/core'
import { createLogger, transformRequest } from '@llmux/core'
import type { RequestFormat } from '../middleware/format'
import {
  buildCodexBody,
  fixOpencodeZenBody,
  getOpencodeZenEndpoint,
  prepareAntigravityRequest,
  prepareOpenAIWebRequest,
  resolveOpencodeZenProtocol,
} from '../providers'
import type { SignatureStore } from '../stores'
import { buildUpstreamHeaders, getDefaultEndpoint } from '../upstream'
import { accountRotationManager } from './account-rotation'
import {
  prepareRequestContext,
  type RequestContext,
  type RetryState,
  removeThinkingFromBody,
} from './request-handler'
import { sanitizeRequestSignatures } from './request-sanitizer'
import type { ProxyOptions } from './types'

const logger = createLogger({ service: 'upstream-request-builder' })

export interface RequestBuilderInput {
  reqId: string
  body: Record<string, unknown>
  options: ProxyOptions
  retryState: RetryState
  mode: 'streaming' | 'non-streaming'
  signatureStore: SignatureStore
  startContext?: RequestContext
}

export interface UpstreamRequestMeta {
  provider: ProviderName
  model: string
  originalModel: string
  currentProjectId?: string
  isThinkingEnabled?: boolean
  isClaudeFresh?: boolean
  streaming: boolean
}

export interface UpstreamRequest {
  endpoint: string
  init: RequestInit & { body: string }
  meta: UpstreamRequestMeta
  providerInfo?: {
    antigravity?: { endpoint: string; account: string }
    openaiWeb?: { endpoint: string }
    geminiCli?: { endpoint: string; account: string }
  }
}

export interface RequestBuilderResult {
  request: UpstreamRequest
  retryState: RetryState
}

function formatToProvider(format: RequestFormat): ProviderName {
  return format as ProviderName
}

export async function buildUpstreamRequest(
  input: RequestBuilderInput
): Promise<RequestBuilderResult> {
  const { reqId, body, options, retryState, mode, signatureStore } = input

  // 1. Context Preparation
  const ctx =
    input.startContext ||
    (await prepareRequestContext({
      body: body as {
        model?: string
        thinking?: unknown
        reasoning_effort?: unknown
      },
      sourceFormat: options.sourceFormat,
      targetProvider: options.targetProvider,
      targetModel: options.targetModel,
      thinking: options.thinking,
      router: options.router,
      modelMappings: options.modelMappings,
      apiKey: options.apiKey,
    }))

  const { isThinkingEnabled, currentModel, effectiveProvider, originalModel } = ctx

  // 2. Body & Thinking Handling
  if (mode === 'streaming' && isThinkingEnabled !== true) {
    removeThinkingFromBody(body)
  }

  // 3. Provider-Specific Pre-Request Logic
  let currentProjectId: string | undefined
  let headers: Record<string, string> = {}
  let endpoint: string | undefined
  const providerInfo: UpstreamRequest['providerInfo'] = {}
  let isClaudeFresh = false

  // Antigravity
  if (effectiveProvider && effectiveProvider === 'antigravity') {
    const antigravityContext = await prepareAntigravityRequest({
      model: currentModel || '',
      accountIndex: retryState.accountIndex,
      overrideProjectId: retryState.overrideProjectId,
      streaming: mode === 'streaming', // Use mode to decide header
      reqId,
    })

    if (antigravityContext) {
      retryState.accountIndex = antigravityContext.accountIndex
      currentProjectId = antigravityContext.projectId
      endpoint = antigravityContext.endpoint
      headers = antigravityContext.headers

      providerInfo.antigravity = {
        endpoint: antigravityContext.endpoint,
        account: antigravityContext.account,
      }

      // Handle Endpoint Rotation
      const baseUrl =
        ANTIGRAVITY_ENDPOINT_FALLBACKS[retryState.antigravityEndpointIndex] ||
        ANTIGRAVITY_ENDPOINT_FALLBACKS[0]
      // Override endpoint if rotation is active (although prepareAntigravityRequest might handle it,
      // but rotation index is in retryState which prepare accepts,
      // yet proxy.ts manually constructs it. Let's align with proxy.ts behavior)
      // prepareAntigravityRequest returns a default endpoint.
      // We should apply the rotation here if needed.
      // Actually prepareAntigravityRequest returns endpoint based on constant.
      // Let's rely on retryState index.
      if (mode === 'streaming') {
        endpoint = `${baseUrl}${ANTIGRAVITY_API_PATH_STREAM}`
      } else {
        endpoint = `${baseUrl}${ANTIGRAVITY_API_PATH_GENERATE}`
      }
    }
  }
  // OpenAI Web
  else if (effectiveProvider && effectiveProvider === 'openai-web') {
    const openaiWebContext = await prepareOpenAIWebRequest({
      model: currentModel || '',
      accountIndex: retryState.accountIndex,
      reqId,
    })

    if (openaiWebContext) {
      retryState.accountIndex = openaiWebContext.accountIndex
      headers = openaiWebContext.headers
      endpoint = openaiWebContext.endpoint
      providerInfo.openaiWeb = { endpoint: openaiWebContext.endpoint }
    } else {
      // Fail fast if no credentials
      throw new Error('No credentials available for OpenAI Web')
    }
  }
  // Gemini CLI - reuse antigravity credentials but with different endpoint/headers
  else if (effectiveProvider && effectiveProvider === 'gemini-cli') {
    // Use the same credential rotation as antigravity
    const antigravityContext = await prepareAntigravityRequest({
      model: currentModel || '',
      accountIndex: retryState.accountIndex,
      overrideProjectId: retryState.overrideProjectId,
      streaming: mode === 'streaming',
      reqId,
    })

    if (antigravityContext) {
      retryState.accountIndex = antigravityContext.accountIndex
      currentProjectId = antigravityContext.projectId

      // Use Gemini CLI endpoint and headers instead of antigravity's
      const geminiCliContext = await prepareGeminiCliRequest({
        model: currentModel || '',
        accountIndex: antigravityContext.accountIndex,
        endpointIndex: retryState.antigravityEndpointIndex,
        streaming: mode === 'streaming',
      })

      if (geminiCliContext) {
        endpoint = geminiCliContext.endpoint
        headers = geminiCliContext.headers

        providerInfo.geminiCli = {
          endpoint: geminiCliContext.endpoint,
          account: antigravityContext.account,
        }
      } else {
        throw new Error('Failed to prepare Gemini CLI context')
      }
    } else {
      throw new Error('No credentials available for Gemini CLI')
    }
  }

  // 4. Signature Sanitization
  const sanitizeResult = sanitizeRequestSignatures({
    messages: (body.messages || []) as Record<string, unknown>[],
    model: currentModel,
    projectId: currentProjectId,
    signatureStore,
    reqId,
  })

  if (sanitizeResult.messages) {
    body.messages = sanitizeResult.messages
  }
  isClaudeFresh = sanitizeResult.strategy === 'claude-fresh'

  // 5. Request Body Transformation
  // gemini-cli uses the same v1internal API as antigravity, so needs the same wrapped request format
  const transformTarget = effectiveProvider === 'gemini-cli' ? 'antigravity' : effectiveProvider
  // biome-ignore lint/suspicious/noExplicitAny: transformRequest accepts any for input body flexibility
  let transformedRequest = transformRequest(body as any, {
    from: formatToProvider(options.sourceFormat),
    to: transformTarget,
    model: currentModel,
    // Claude fresh strategy: disable thinking block injection to avoid Invalid signature errors
    // (sanitizeRequestSignatures already removed thinking blocks, don't re-inject them)
    thinkingOverride: isThinkingEnabled !== true || isClaudeFresh ? { enabled: false } : undefined,
    metadata:
      effectiveProvider === 'antigravity' || effectiveProvider === 'gemini-cli'
        ? { project: currentProjectId, model: currentModel }
        : undefined,
  }) as Record<string, unknown>

  // Debug transformed request structure
  // biome-ignore lint/suspicious/noExplicitAny: Accessing potential messages array for debug logging
  const debugMessages = (transformedRequest as any).messages
  if (Array.isArray(debugMessages)) {
    // biome-ignore lint/suspicious/noExplicitAny: Mapping message structure for debug logging
    const summary = debugMessages.map((m: any) => ({
      role: m.role,
      // biome-ignore lint/suspicious/noExplicitAny: Accessing parts safely for logging
      parts: m.parts?.map((p: any) => p.type || Object.keys(p)[0]),
    }))
    logger.debug({ reqId, messageStructure: summary }, 'Transformed request structure')
  }

  // 6. Provider-Specific Body Adjustments (Post-Transform)
  if (effectiveProvider && effectiveProvider === 'openai-web') {
    const typedBody = body as {
      messages?: unknown[]
      input?: unknown[]
      tools?: unknown[]
      reasoning?: unknown
      thinking?: unknown
    }
    // Messages might be in original body or transformed, depends on transformRequest behavior for openai-web
    // transformRequest typically returns { model, messages, ... }
    // Use original body's messages/input if transformedRequest.messages is empty
    let messages = transformedRequest.messages
    if (!messages || (Array.isArray(messages) && messages.length === 0)) {
      // Check messages first, then input - but both need to be non-empty arrays
      const originalMessages = typedBody.messages
      const originalInput = typedBody.input
      if (Array.isArray(originalMessages) && originalMessages.length > 0) {
        messages = originalMessages
      } else if (Array.isArray(originalInput) && originalInput.length > 0) {
        messages = originalInput
      }
    }

    logger.info(
      {
        reqId,
        sourceFormat: options.sourceFormat,
        transformedMessagesLen: Array.isArray(transformedRequest.messages)
          ? transformedRequest.messages.length
          : undefined,
        originalMessagesLen: typedBody.messages?.length,
        originalInputLen: typedBody.input?.length,
        resolvedMessagesLen: Array.isArray(messages) ? messages.length : undefined,
        messagesSample: Array.isArray(messages) ? messages.slice(0, 1) : undefined,
      },
      '[openai-web] Debugging missing input error'
    )

    if (!messages) {
      logger.warn({ reqId }, '[openai-web] No messages found, defaulting to empty array')
      messages = []
    }

    transformedRequest = await buildCodexBody({
      model: currentModel || '',
      // biome-ignore lint/suspicious/noExplicitAny: cast to any
      messages: messages as any[],
      // biome-ignore lint/suspicious/noExplicitAny: cast to any
      tools: typedBody.tools as any,
      reasoning: typedBody.reasoning || typedBody.thinking,
      // System instructions are handled inside buildCodexBody via getCodexInstructions
    })
  } else if (effectiveProvider && effectiveProvider === 'opencode-zen') {
    fixOpencodeZenBody(transformedRequest, { thinkingEnabled: isThinkingEnabled })
  }

  // 7. Auth & Endpoint Finalization (Generic)
  if (!endpoint) {
    if (effectiveProvider && effectiveProvider === 'opencode-zen') {
      const protocol = resolveOpencodeZenProtocol(currentModel || '')
      if (protocol) {
        endpoint = getOpencodeZenEndpoint(protocol)
      }
    }
  }

  // Generic Auth Provider fallback
  if (!endpoint || Object.keys(headers).length === 0) {
    const currentAuthProvider = AuthProviderRegistry.get(effectiveProvider)

    // If we haven't handled auth yet (not special provider) and no API key
    if (
      currentAuthProvider &&
      !options.apiKey &&
      effectiveProvider !== 'antigravity' &&
      effectiveProvider !== 'openai-web'
    ) {
      try {
        const creds = await TokenRefresh.ensureFresh(effectiveProvider)
        retryState.accountIndex = accountRotationManager.getNextAvailable(
          effectiveProvider,
          currentModel || '',
          creds || []
        )
        const credential = creds?.[retryState.accountIndex]
        if (!credential) throw new Error('No credentials')

        if (!endpoint) {
          endpoint = currentAuthProvider.getEndpoint(options.targetModel || currentModel || '', {
            streaming: mode === 'streaming',
          })
        }
        headers = await currentAuthProvider.getHeaders(credential, {
          model: options.targetModel || currentModel,
        })
      } catch (_e) {
        if (!endpoint) endpoint = '' // Handle later
        // If auth fails, we might still try with what we have or let fetch fail?
        // Proxy.ts returns 401. We can let Dispatcher handle errors, but here we construct request.
        // If we throw here, dispatcher catches it.
        throw new Error(`No credentials for ${effectiveProvider}`)
      }
    } else if (!endpoint || Object.keys(headers).length === 0) {
      // Standard endpoint/header
      if (!endpoint) {
        endpoint =
          getDefaultEndpoint(effectiveProvider, {
            streaming: mode === 'streaming',
            model: currentModel,
          }) || ''
      }
      if (Object.keys(headers).length === 0) {
        headers = buildUpstreamHeaders(effectiveProvider, options.apiKey, {
          fromProtocol: currentModel?.includes('claude') ? 'anthropic' : undefined,
        })
      }
    }
  }

  if (!endpoint) {
    throw new Error(`Could not resolve endpoint for ${effectiveProvider}`)
  }

  const requestBody = JSON.stringify(transformedRequest)

  // Debug log for gemini-cli provider to understand request structure
  if (effectiveProvider && effectiveProvider === 'gemini-cli') {
    logger.debug(
      {
        reqId,
        provider: effectiveProvider,
        endpoint,
        bodyPreview: requestBody.slice(0, 500),
        hasProject: 'project' in transformedRequest,
        hasRequest: 'request' in transformedRequest,
        hasContents: 'contents' in transformedRequest,
        topLevelKeys: Object.keys(transformedRequest),
      },
      'Gemini CLI request structure'
    )

    // Write full request to file for debugging
    try {
      const fs = await import('node:fs')
      fs.writeFileSync(
        `/tmp/gemini-cli-request-${reqId}.json`,
        JSON.stringify(transformedRequest, null, 2)
      )
      logger.debug(
        { reqId, path: `/tmp/gemini-cli-request-${reqId}.json` },
        'Wrote request to file'
      )
    } catch {
      // Ignore write errors
    }
  }

  return {
    request: {
      endpoint,
      init: {
        method: 'POST',
        headers,
        body: requestBody,
      },
      meta: {
        provider: effectiveProvider,
        model: currentModel || '',
        originalModel,
        currentProjectId,
        isThinkingEnabled,
        isClaudeFresh,
        streaming: mode === 'streaming',
      },
      providerInfo,
    },
    retryState,
  }
}
