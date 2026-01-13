import type { UnifiedRequest } from '../../types/unified'
import type { OpenAIChatRequest, OpenAIChatThinkingConfig } from './types'

// =============================================================================
// Config Parsing
// =============================================================================

export function parseConfig(request: OpenAIChatRequest): NonNullable<UnifiedRequest['config']> {
  const config: NonNullable<UnifiedRequest['config']> = {}

  if (request.max_tokens !== undefined) {
    config.maxTokens = request.max_tokens
  }
  // O-series models use max_completion_tokens
  if (request.max_completion_tokens !== undefined) {
    config.maxTokens = request.max_completion_tokens
  }
  if (request.temperature !== undefined) {
    config.temperature = request.temperature
  }
  if (request.top_p !== undefined) {
    config.topP = request.top_p
  }
  if (request.stop !== undefined) {
    config.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop]
  }

  if (request.logprobs !== undefined) {
    config.logprobs = request.logprobs
  }
  if (request.response_format) {
    // Basic mapping - expand if needed for strictJsonSchema
    config.responseFormat = request.response_format.type === 'json_object' ? 'json' : undefined
    if (request.response_format.type === 'json_object') {
      config.responseFormat = 'json'
    } else if (request.response_format.type !== 'text') {
      // Keep raw if it's complex schema
      config.responseFormat = request.response_format
    }
  }
  if (request.service_tier) {
    config.serviceTier = request.service_tier as 'auto' | 'flex' | 'priority'
  }
  if (request.parallel_tool_calls !== undefined) {
    config.parallelToolCalls = request.parallel_tool_calls
  }

  // Prompt Cache Key (OpenCode convention)
  if (request.user?.startsWith('cache:')) {
    // Provisional: extract cache key from user field or dedicated promptCacheKey if supported
  }

  return config
}

// =============================================================================
// Thinking Config
// =============================================================================

/**
 * Parse GLM thinking configuration into UnifiedRequest thinking config
 */
export function parseGLMThinking(
  config: OpenAIChatThinkingConfig
): NonNullable<UnifiedRequest['thinking']> {
  const result: NonNullable<UnifiedRequest['thinking']> = {
    enabled: config.type !== 'disabled',
  }

  // clear_thinking: false means preserve context
  if (config.clear_thinking === false) {
    result.preserveContext = true
  }

  // Parse thinking budget (used by Gemini, Claude via Antigravity)
  const configAny = config as Record<string, unknown>
  if (typeof configAny.budget_tokens === 'number') {
    result.budget = configAny.budget_tokens
  }

  return result
}

/**
 * Transform UnifiedRequest thinking config into GLM thinking format
 */
export function transformToGLMThinking(
  thinking: UnifiedRequest['thinking']
): OpenAIChatThinkingConfig | undefined {
  if (!thinking) {
    return undefined
  }

  const result: OpenAIChatThinkingConfig = {
    type: thinking.enabled ? 'enabled' : 'disabled',
  }

  // preserveContext: true means clear_thinking: false
  if (thinking.preserveContext === true) {
    result.clear_thinking = false
  }

  return result
}

/**
 * Apply thinking config for OpenAI format (localized version, no external dependency)
 */
export function applyThinkingConfig(
  unified: UnifiedRequest,
  _model: string,
  targetRequest: OpenAIChatRequest
): void {
  const config = unified.thinking
  if (!config || !config.enabled) {
    return
  }

  if (config.effort) {
    targetRequest.reasoning_effort = config.effort
  }
  if (config.includeThoughts) {
    // For OpenAI, include reasoning.encrypted_content in the include array
    // This is typically set at the API call level, not in the request body
    // We leave this as a no-op since OpenAI handles it differently
  }
}

// =============================================================================
// Model Detection Utilities
// =============================================================================

/**
 * Check if the model is an O-series reasoning model (o1, o3, etc.)
 */
export function isReasoningModel(model: string): boolean {
  const lowerModel = model.toLowerCase()
  return (
    lowerModel.startsWith('o1') ||
    lowerModel.startsWith('o3') ||
    lowerModel.includes('-o1') ||
    lowerModel.includes('-o3') ||
    lowerModel.includes('gpt-5') // Treat gpt-5.1 as reasoning model (provisional)
  )
}

/**
 * Check if the model is a GLM model (glm-4.5, glm-4.6, glm-4.7, etc.)
 */
export function isGLMModel(model: string): boolean {
  const lowerModel = model.toLowerCase()
  return lowerModel.startsWith('glm-') || lowerModel.startsWith('glm_')
}
