/**
 * Transform utilities for Antigravity provider
 * Helper functions for building AntigravityInnerRequest
 */

import type { RequestMetadata, UnifiedRequest } from '../../types/unified'
import type { GeminiRequest } from '../gemini/types'
import { DEFAULT_THINKING_BUDGET, THINKING_BUDGETS } from './constants'
import type {
  AntigravityGenerationConfig,
  AntigravityInnerRequest,
  AntigravityRequestMetadata,
  AntigravitySystemInstruction,
} from './types'

/**
 * Model type detection helpers
 */
export function isClaudeModel(model: string): boolean {
  return model.toLowerCase().includes('claude')
}

export function isGemini3Model(model: string): boolean {
  return model.toLowerCase().includes('gemini-3')
}

/**
 * Determines if a model supports thinking features.
 * Delegates to the centralized model-capabilities module.
 */
export function isThinkingModel(model: string): boolean {
  const m = model.toLowerCase()
  return m.includes('thinking') || m.includes('gemini-3')
}

/**
 * Injects system instruction for Claude and Gemini 3 models
 */
export function injectSystemInstruction(
  request: AntigravityInnerRequest,
  systemPrompt: string,
  model: string
): void {
  if (!isClaudeModel(model) && !isGemini3Model(model)) {
    return
  }

  if (!request.systemInstruction) {
    request.systemInstruction = {
      role: 'user',
      parts: [{ text: systemPrompt }],
    }
    return
  }

  request.systemInstruction.role = 'user'
  const parts = request.systemInstruction.parts
  const alreadyHasIt = parts.some((p) => p.text?.includes('You are Antigravity'))
  if (!alreadyHasIt) {
    parts.unshift({ text: systemPrompt })
  }
}

/**
 * Ensures toolConfig has VALIDATED mode for Claude models
 */
export function ensureToolConfig(request: AntigravityInnerRequest, model: string): void {
  if (!isClaudeModel(model)) {
    return
  }

  if (!request.toolConfig) {
    request.toolConfig = {
      functionCallingConfig: {
        mode: 'VALIDATED',
      },
    }
    return
  }

  if (!request.toolConfig.functionCallingConfig) {
    request.toolConfig.functionCallingConfig = {
      mode: 'VALIDATED',
    }
    return
  }

  request.toolConfig.functionCallingConfig.mode = 'VALIDATED'
}

/**
 * Pre-processes UnifiedRequest for Antigravity-specific constraints.
 * - For Claude models: enforces min output tokens and sets default budgets.
 * - Handles thinking config validation.
 */
export function preprocessAntigravityRequest(
  request: UnifiedRequest,
  model: string
): UnifiedRequest {
  const isClaude = isClaudeModel(model)
  const isThinking = isThinkingModel(model)
  const thinkingEnabled = request.thinking?.enabled

  // 1. If thinking is not supported or not enabled, strip thinking to prevent issues
  if (!isThinking || !thinkingEnabled) {
    if (request.thinking) {
      const { thinking, ...rest } = request
      return rest
    }
    return request
  }

  // 2. If it is a thinking request, enforce policies (Min Tokens, Default Budget)
  let newConfig = request.config
  let newThinking = request.thinking
  let modified = false

  // 2.1 Determine Budget if missing
  // Antigravity requires an explicit budget if not provided by user
  if (!newThinking?.budget) {
    let budget: number = DEFAULT_THINKING_BUDGET

    const effort = newThinking?.effort
    const level = newThinking?.level

    if (effort && effort !== 'none') {
      budget = THINKING_BUDGETS[effort] || budget
    } else if (level && level !== 'minimal') {
      budget = THINKING_BUDGETS[level] || budget
    }

    newThinking = { ...newThinking, budget, enabled: true }
    modified = true
  }

  // 2.2 Ensure maxTokens is greater than thinking budget for Claude
  if (isClaude && newThinking?.budget !== undefined) {
    const requiredMaxTokens = newThinking.budget + 1
    const currentMaxTokens = newConfig?.maxTokens
    if (currentMaxTokens === undefined || currentMaxTokens <= requiredMaxTokens) {
      newConfig = { ...newConfig, maxTokens: requiredMaxTokens }
      modified = true
    }
  }

  if (!modified) {
    return request
  }

  return {
    ...request,
    config: newConfig,
    thinking: newThinking,
  }
}

/**
 * Extracts metadata fields from UnifiedRequest metadata
 */
export function extractMetadata(
  metadata: RequestMetadata | undefined
): AntigravityRequestMetadata | undefined {
  if (!metadata) {
    return undefined
  }

  const result: AntigravityRequestMetadata = {}
  let hasFields = false

  if (metadata.duetProject) {
    result.duetProject = metadata.duetProject
    hasFields = true
  }
  if (metadata.ideType) {
    result.ideType = metadata.ideType
    hasFields = true
  }
  if (metadata.platform) {
    result.platform = metadata.platform
    hasFields = true
  }
  if (metadata.pluginType) {
    result.pluginType = metadata.pluginType
    hasFields = true
  }
  if (metadata.promptCacheKey) {
    result.promptCacheKey = metadata.promptCacheKey
    hasFields = true
  }

  return hasFields ? result : undefined
}

/**
 * Creates AntigravityInnerRequest from GeminiRequest
 */
export function createInnerRequest(
  geminiRequest: GeminiRequest,
  sessionId: string
): AntigravityInnerRequest {
  return {
    contents: geminiRequest.contents,
    systemInstruction: geminiRequest.systemInstruction as AntigravitySystemInstruction | undefined,
    tools: geminiRequest.tools,
    toolConfig: geminiRequest.toolConfig,
    generationConfig: geminiRequest.generationConfig as AntigravityGenerationConfig | undefined,
    sessionId,
  }
}

export { preprocessTools } from '../../schema/tool-sanitizer'
