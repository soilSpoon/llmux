import {
  createLogger,
  formatIdToProviderName,
  getProvider,
  type MetadataInjectionStrategy,
  type ProviderName,
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
  isThinkingEnabled?: boolean
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
    isThinkingEnabled,
    signatureStore,
    mode,
  } = input

  // 1. Thinking Handling
  if (mode === 'streaming' && isThinkingEnabled !== true) {
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
  if (isThinkingEnabled !== true || isClaudeFresh) {
    unifiedRequest.thinking = { enabled: false }
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
    fixOpencodeZenBody(transformedRequest, { thinkingEnabled: isThinkingEnabled })
  }

  return { transformedRequest, isClaudeFresh }
}
