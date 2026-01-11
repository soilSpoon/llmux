import {
  ANTIGRAVITY_API_PATH_GENERATE,
  ANTIGRAVITY_API_PATH_STREAM,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  AuthProviderRegistry,
  prepareGeminiCliRequest,
  TokenRefresh,
} from '@llmux/auth'
import type { ProviderName } from '@llmux/core'
import { createLogger, formatIdToProviderName, getProvider } from '@llmux/core'
import {
  buildCodexBody,
  type CodexBodyOptions,
  fixOpencodeZenBody,
  getOpencodeZenEndpoint,
  prepareAntigravityRequest,
  prepareOpenAIWebRequest,
  resolveOpencodeZenProtocol,
} from '../providers'
import type { SignatureStore } from '../stores'
import { buildUpstreamHeaders, getDefaultEndpoint } from '../upstream'
import { accountRotationManager } from './account-rotation'
import { applyPromptCaching } from './caching-utils'
import {
  injectSystemInstructions,
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
      originalModel: options.originalModel,
      thinking: options.thinking,
      router: options.router,
      modelMappings: options.modelMappings,
      apiKey: options.apiKey,
      defaultProvider: options.defaultProvider,
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
    logger.debugTemp(
      { reqId, model: currentModel, accountIndex: retryState.accountIndex },
      'Preparing Antigravity request'
    )
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

      logger.debugTemp(
        {
          reqId,
          projectId: antigravityContext.projectId,
          account: antigravityContext.account,
          endpoint: antigravityContext.endpoint,
        },
        'Antigravity context prepared'
      )

      providerInfo.antigravity = {
        endpoint: antigravityContext.endpoint,
        account: antigravityContext.account,
      }

      // Endpoint already selected by prepareAntigravityRequest based on account rotation
      // But handle retry-triggered endpoint rotation (retryState tracks failed attempts)
      if (retryState.antigravityEndpointIndex > 0) {
        // Retry: use the next endpoint from the fallback list
        const baseUrl =
          ANTIGRAVITY_ENDPOINT_FALLBACKS[retryState.antigravityEndpointIndex] ||
          ANTIGRAVITY_ENDPOINT_FALLBACKS[0]
        if (mode === 'streaming') {
          endpoint = `${baseUrl}${ANTIGRAVITY_API_PATH_STREAM}`
        } else {
          endpoint = `${baseUrl}${ANTIGRAVITY_API_PATH_GENERATE}`
        }
      }
      // Otherwise use endpoint from prepareAntigravityRequest (already set above)
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
  const messagesBeforeSanitize = Array.isArray(body.messages) ? body.messages : []

  const sanitizeResult = sanitizeRequestSignatures({
    messages: messagesBeforeSanitize as Record<string, unknown>[],
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

  // Apply prompt caching if enabled (could check options/config here)
  // For now, applying universally for supported providers, as it's opt-in via cacheControl/promptCacheKey anyway
  // or benign if not supported.

  // Need to parse first to get UnifiedRequest for modification
  // But transformRequest does parse + transform in one go.
  // We should probably inject a hook or use a different flow if we want to modify UnifiedRequest.
  // Currently transformRequest in core doesn't expose the intermediate UnifiedRequest easily
  // unless we split parse and transform.

  // Refactor: We should parse -> apply caching -> transform.
  // But transformRequest is a black box.

  // However, Core's transformRequest takes a raw body.
  // We can't apply caching to raw body easily across all formats.

  // Solution: We'll rely on the `transformRequest` function in core to be updated OR
  // we update `transformRequest` to accept a hook/callback or we split the call here.

  // Let's import parse/transform separately from core/providers/registry
  // or use the provider instance directly.

  // For now, let's use the provider registry to get the provider, parse, modify, then transform.

  const sourceProvider = getProvider(formatIdToProviderName(options.sourceFormat))
  const targetProvider = getProvider(transformTarget)

  const unifiedRequest = sourceProvider.parse(body)

  // Apply Thinking Override
  if (isThinkingEnabled !== true || isClaudeFresh) {
    unifiedRequest.thinking = { enabled: false }
  }

  // Inject System Instructions & Tool Hardening
  injectSystemInstructions(unifiedRequest, effectiveProvider, currentModel || '')

  // Apply Prompt Caching
  applyPromptCaching(unifiedRequest, transformTarget)

  // Merge metadata (including reqId from x-amp-client-request-id header)
  if (effectiveProvider === 'antigravity' || effectiveProvider === 'gemini-cli') {
    logger.debugTemp(
      { reqId, projectId: currentProjectId, model: currentModel, provider: effectiveProvider },
      'Merging metadata for Antigravity/Gemini-CLI request'
    )
    unifiedRequest.metadata = {
      ...unifiedRequest.metadata,
      project: currentProjectId,
      model: currentModel,
      requestId: reqId, // From x-amp-client-request-id header or generated UUID
    }
  }

  // Transform UnifiedRequest to Provider Request format
  const rawTransformed = targetProvider.transform(unifiedRequest, currentModel || '')
  if (!rawTransformed || typeof rawTransformed !== 'object') {
    throw new Error(`Provider ${effectiveProvider} transformation failed to return an object`)
  }
  let transformedRequest = rawTransformed as Record<string, unknown>

  // 6. Provider-Specific Body Adjustments (Post-Transform)
  if (effectiveProvider && effectiveProvider === 'openai-web') {
    interface OpenAIWebBody {
      messages?: unknown[]
      input?: unknown[]
      tools?: unknown[]
      reasoning?: unknown
      thinking?: unknown
    }
    const typedBody = body as OpenAIWebBody

    // Messages might be in original body or transformed, depends on transformRequest behavior for openai-web
    // transformRequest typically returns { model, messages, ... }
    // Use original body's messages/input if transformedRequest.messages is empty
    let messages: unknown = (transformedRequest as Record<string, unknown>).messages
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

    if (!messages) {
      logger.warn({ reqId }, '[openai-web] No messages found, defaulting to empty array')
      messages = []
    }

    const codexOptions: CodexBodyOptions = {
      model: currentModel || '',
      messages,
      tools: typedBody.tools as CodexBodyOptions['tools'],
      reasoning: typedBody.reasoning || typedBody.thinking,
      // Provide system instructions for logging purposes (provider will decide to ignore them)
      systemInstructions: (transformedRequest as { instructions?: string })?.instructions,
    }
    transformedRequest = await buildCodexBody(codexOptions)
  } else if (effectiveProvider && effectiveProvider === 'opencode-zen') {
    fixOpencodeZenBody(transformedRequest, { thinkingEnabled: isThinkingEnabled })
  }

  // 7. Auth & Endpoint Finalization (Generic)
  if (!endpoint) {
    if (effectiveProvider && effectiveProvider === 'opencode-zen') {
      const protocol = resolveOpencodeZenProtocol(currentModel || '')
      if (protocol) {
        endpoint =
          protocol === 'gemini'
            ? getOpencodeZenEndpoint(protocol, currentModel || '')
            : getOpencodeZenEndpoint(protocol)
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
