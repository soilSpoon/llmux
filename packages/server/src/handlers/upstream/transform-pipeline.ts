import {
  createLogger,
  formatIdToProviderName,
  getProvider,
  type MetadataInjectionStrategy,
  type ProviderName,
  type ThinkingPolicy,
} from '@llmux/core'
import { buildCodexBody, type CodexBodyOptions, fixOpencodeZenBody } from '../../providers'
import type { SignatureStore } from '../../stores'
import { applyPromptCaching } from '../caching-utils'
import { removeThinkingFromBody } from '../request-handler'
import { sanitizeRequestSignatures } from '../request-sanitizer'
import type { ProxyOptions } from '../types'

const logger = createLogger({ service: 'transform-pipeline' })

export interface TransformPipelineInput {
  body: Record<string, unknown>
  currentModel: string
  effectiveProvider: ProviderName
  options: ProxyOptions
  reqId: string
  currentProjectId?: string
  thinkingPolicy?: ThinkingPolicy
  signatureStore: SignatureStore
  mode: 'streaming' | 'non-streaming' | 'count_tokens'
}

export interface TransformResult {
  transformedRequest: Record<string, unknown>
  isClaudeFresh: boolean
}

export async function executeTransformPipeline(
  input: TransformPipelineInput
): Promise<TransformResult> {
  const {
    body,
    currentModel,
    effectiveProvider,
    options,
    reqId,
    currentProjectId,
    thinkingPolicy,
    signatureStore,
    mode,
  } = input

  // 1. Thinking Handling
  // Use thinking policy if available, otherwise fallback to permissive behavior
  // NOTE: isClaudeFresh is computed later, so we will combine them for the effective policy
  const policyEnabled = thinkingPolicy?.enabled
  const sendThinkingToUpstream = thinkingPolicy?.sendThinkingToUpstream

  // Only remove when explicitly disabled by policy (and policy is present)
  if (mode === 'streaming' && policyEnabled === false) {
    removeThinkingFromBody(body)
  }

  // 2. Signature Sanitization
  const messagesBeforeSanitize = Array.isArray(body.messages) ? body.messages : []
  const sanitizeResult = sanitizeRequestSignatures({
    messages: messagesBeforeSanitize as Record<string, unknown>[],
    model: currentModel,
    projectId: currentProjectId,
    signatureStore,
    reqId,
    provider: effectiveProvider,
  })

  if (sanitizeResult.messages) {
    body.messages = sanitizeResult.messages
  }
  const isClaudeFresh = sanitizeResult.strategy === 'claude-fresh'

  // 3. Request Body Transformation
  const transformTarget = effectiveProvider === 'gemini-cli' ? 'antigravity' : effectiveProvider

  const sourceProvider = getProvider(formatIdToProviderName(options.sourceFormat))
  const targetProvider = getProvider(transformTarget)

  const unifiedRequest = sourceProvider.parse(body)

  // Apply Thinking Override
  // Disable thinking if:
  // 1. Policy explicitly disables it (policyEnabled === false)
  // 2. We are in Claude Fresh mode (stripping signatures means we can't send thinking config securely/compatibly)
  // 3. Policy says don't send to upstream (sendThinkingToUpstream === false)
  const shouldDisableThinking =
    policyEnabled === false || isClaudeFresh || sendThinkingToUpstream === false

  if (shouldDisableThinking) {
    if (unifiedRequest.thinking) {
      unifiedRequest.thinking.enabled = false
    } else {
      unifiedRequest.thinking = { enabled: false }
    }
  } else if (policyEnabled === true) {
    // Ensure thinking is enabled in the unified request if policy dictates it
    if (!unifiedRequest.thinking) {
      unifiedRequest.thinking = { enabled: true }
    } else {
      unifiedRequest.thinking.enabled = true
    }
  }

  // Apply Prompt Caching
  applyPromptCaching(unifiedRequest, transformTarget)

  // Merge metadata using Strategy Pattern
  let metadataStrategy: MetadataInjectionStrategy | null = null
  try {
    const provider = getProvider(effectiveProvider)
    metadataStrategy = provider.getStrategy<MetadataInjectionStrategy>('metadata')
  } catch {
    // ignore
  }

  if (metadataStrategy?.requiresInjection(currentModel || '')) {
    const injectedMetadata = metadataStrategy.getMetadata({
      model: currentModel || '',
      projectId: currentProjectId,
      requestId: reqId,
    })

    unifiedRequest.metadata = {
      ...unifiedRequest.metadata,
      ...injectedMetadata,
    }
  }

  // Transform UnifiedRequest to Provider Request format
  const rawTransformed = targetProvider.transform(unifiedRequest, currentModel || '')
  if (!rawTransformed || typeof rawTransformed !== 'object') {
    throw new Error(`Provider ${effectiveProvider} transformation failed to return an object`)
  }
  let transformedRequest = rawTransformed as Record<string, unknown>

  // 4. Provider-Specific Body Adjustments (Post-Transform)
  if (effectiveProvider === 'openai-web') {
    interface OpenAIWebBody {
      messages?: unknown[]
      input?: unknown[]
      tools?: unknown[]
      reasoning?: unknown
      thinking?: unknown
    }
    const typedBody = body as OpenAIWebBody

    let messages: unknown = (transformedRequest as Record<string, unknown>).messages
    if (!messages || (Array.isArray(messages) && messages.length === 0)) {
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
      systemInstructions: (transformedRequest as { instructions?: string })?.instructions,
    }
    transformedRequest = await buildCodexBody(codexOptions)
  } else if (effectiveProvider === 'opencode-zen') {
    fixOpencodeZenBody(transformedRequest, { thinkingEnabled: policyEnabled })
  }

  return { transformedRequest, isClaudeFresh }
}
