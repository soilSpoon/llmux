import {
  computeThinkingPolicy,
  getProvider,
  type ProviderName,
  type ThinkingPolicy,
  type UpstreamPreparationStrategy,
} from '@llmux/core'
import type { SignatureStore } from '../stores'
import { AllCooldownError } from './error-utils'
import { prepareRequestContext, type RequestContext, type RetryState } from './request-handler'
import { getThinkingStrategy } from './thinking-utils'
import type { ProxyOptions } from './types'
import { resolveGenericContext, resolveSpecialProviderContext } from './upstream/provider-context'
import { executeTransformPipeline } from './upstream/transform-pipeline'

export interface RequestBuilderInput {
  reqId: string
  body: Record<string, unknown>
  options: ProxyOptions
  retryState: RetryState
  mode: 'streaming' | 'non-streaming' | 'count_tokens'
  signatureStore: SignatureStore
  startContext?: RequestContext
}

export interface UpstreamRequestMeta {
  provider: ProviderName
  model: string
  originalModel: string
  currentProjectId?: string
  isThinkingEnabled?: boolean
  thinkingPolicy?: ThinkingPolicy
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

  // Compute Thinking Policy
  const typedBody = body as { thinking?: { budget?: number }; include_thoughts?: boolean }
  const clientThinking = {
    enabled: isThinkingEnabled,
    budget: typedBody.thinking?.budget,
    includeThoughts: typedBody.include_thoughts,
  }

  const isClaudeFreshStrategy = getThinkingStrategy(currentModel) === 'claude-fresh'

  const thinkingPolicy = computeThinkingPolicy({
    model: currentModel || '',
    mode,
    clientThinking,
    optionsThinking: options.thinking,
    isClaudeFresh: isClaudeFreshStrategy,
    sourceFormat: options.sourceFormat,
    targetProvider: effectiveProvider,
  })

  let currentProjectId: string | undefined
  let headers: Record<string, string> = {}
  let endpoint: string | undefined
  const providerInfo: UpstreamRequest['providerInfo'] = {}

  // 2. Upstream Strategy (Antigravity, Gemini-CLI, etc.)
  let upstreamStrategy: UpstreamPreparationStrategy | null = null
  try {
    if (effectiveProvider) {
      const instance = getProvider(effectiveProvider)
      upstreamStrategy = instance.getStrategy<UpstreamPreparationStrategy>('upstream')
    }
  } catch {
    // Provider might not be registered or found
  }

  if (upstreamStrategy) {
    try {
      const context = await upstreamStrategy.prepare({
        model: currentModel || '',
        accountIndex: retryState.accountIndex,
        overrideProjectId: retryState.overrideProjectId || undefined,
        streaming: mode === 'streaming',
        reqId,
        provider: effectiveProvider,
        retryEndpointIndex: retryState.antigravityEndpointIndex,
        thinkingPolicy,
      })

      retryState.accountIndex = context.accountIndex
      currentProjectId = context.projectId
      endpoint = context.endpoint
      headers = context.headers

      if (context.providerInfo) {
        Object.assign(providerInfo, context.providerInfo)
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('No credentials available') ||
          err.message.includes('No credentials found'))
      ) {
        throw new AllCooldownError(err.message, effectiveProvider, currentModel)
      }
      throw err
    }
  } else {
    // 3. Special Providers Resolution (OpenAI Web, Gemini CLI, etc.)
    const specialContext = await resolveSpecialProviderContext(
      effectiveProvider,
      currentModel || '',
      retryState,
      reqId,
      mode === 'streaming'
    )

    if (specialContext) {
      endpoint = specialContext.endpoint
      headers = specialContext.headers
      currentProjectId = specialContext.projectId
      Object.assign(providerInfo, specialContext.providerInfo)
      Object.assign(retryState, specialContext.updatedRetryState)
    }
  }

  // 4. Transform Pipeline (Thinking, Signature Sanitization, Body Transformation)
  const { transformedRequest, isClaudeFresh } = await executeTransformPipeline({
    body,
    currentModel: currentModel || '',
    effectiveProvider,
    options,
    reqId,
    currentProjectId,
    isThinkingEnabled,
    signatureStore,
    mode,
  })

  // 5. Auth & Endpoint Finalization (Generic Fallback)
  if (!endpoint) {
    const genericContext = await resolveGenericContext(
      effectiveProvider,
      currentModel || '',
      retryState,
      options,
      mode
    )
    endpoint = genericContext.endpoint
    headers = genericContext.headers
    Object.assign(providerInfo, genericContext.providerInfo)
    Object.assign(retryState, genericContext.updatedRetryState)
  }

  if (!endpoint) {
    throw new Error(`Could not resolve endpoint for ${effectiveProvider}`)
  }

  const requestBody = JSON.stringify(transformedRequest)

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
        thinkingPolicy,
        isClaudeFresh,
        streaming: mode === 'streaming',
      },
      providerInfo,
    },
    retryState,
  }
}
