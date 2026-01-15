/**
 * Model Capability Utilities
 *
 * Centralized logic for determining model capabilities:
 * - Thinking support
 * - Tier suffix handling
 * - Provider-specific constraints
 */

/**
 * Check if model has a thinking tier suffix (-low, -medium, -high)
 */
export function hasThinkingTierSuffix(modelName: string): boolean {
  return modelName.endsWith('-high') || modelName.endsWith('-medium') || modelName.endsWith('-low')
}

/**
 * Check if model is Gemini 3 with tier suffix
 * These models do NOT support thinking configuration
 */
export function isGemini3WithTierSuffix(modelName: string): boolean {
  return modelName.includes('gemini-3') && hasThinkingTierSuffix(modelName)
}

/**
 * Check if model supports thinking at all
 *
 * Models that do NOT support thinking:
 * - Gemini 3 with tier suffix (e.g., gemini-3-pro-high)
 * - Non-Claude, non-Gemini-thinking models
 *
 * @param modelName - Full model name
 * @param isClaudeModel - Whether this is explicitly a Claude model
 * @param isThinkingModel - Whether the model name contains 'thinking'
 * @returns true if thinking is supported
 */
export function supportsThinking(
  modelName: string,
  isClaudeModel: boolean = false,
  isThinkingModel: boolean = false
): boolean {
  // Gemini 3 with tier suffix explicitly does NOT support thinking
  if (isGemini3WithTierSuffix(modelName)) {
    return false
  }

  // Claude thinking models support thinking
  if (isClaudeModel && isThinkingModel) {
    return true
  }

  // Generic Gemini 3 (without tier suffix) can support thinking
  if (modelName.includes('gemini-3') && !hasThinkingTierSuffix(modelName)) {
    return true
  }

  // Default: assume no thinking support for safety
  return false
}

/**
 * Extract thinking tier from model name suffix
 *
 * Example: "claude-opus-4-5-thinking-high" -> "high"
 *
 * @returns The tier ('low', 'medium', 'high') or undefined
 */
export function extractThinkingTier(modelName: string): string | undefined {
  if (modelName.endsWith('-high')) return 'high'
  if (modelName.endsWith('-medium')) return 'medium'
  if (modelName.endsWith('-low')) return 'low'
  return undefined
}

/**
 * Reasoning effort values supported across providers.
 * Different models support different subsets of these values.
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/**
 * Model-specific reasoning effort configuration
 */
interface ModelReasoningConfig {
  supportedEfforts: ReasoningEffort[]
  defaultEffort: ReasoningEffort | undefined
}

/**
 * Model-specific reasoning effort support.
 * Patterns are checked in order; first match wins.
 */
const MODEL_REASONING_CONFIGS: Array<{ pattern: RegExp; config: ModelReasoningConfig }> = [
  // gpt-5.1-codex-max and variants support all effort levels
  {
    pattern: /^gpt-5\.1-codex-max/,
    config: {
      supportedEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      defaultEffort: undefined,
    },
  },
  // gpt-5-pro only supports high
  {
    pattern: /^gpt-5-pro/,
    config: {
      supportedEfforts: ['high'],
      defaultEffort: 'high',
    },
  },
  // gpt-5.1 supports none (default), low, medium, high
  {
    pattern: /^gpt-5\.1/,
    config: {
      supportedEfforts: ['none', 'low', 'medium', 'high'],
      defaultEffort: undefined,
    },
  },
]

/**
 * Default reasoning config for unknown models.
 * Allows standard effort levels with no default.
 */
const DEFAULT_REASONING_CONFIG: ModelReasoningConfig = {
  supportedEfforts: ['low', 'medium', 'high'],
  defaultEffort: undefined,
}

/**
 * Get reasoning configuration for a specific model.
 *
 * @param model - Model name
 * @returns ModelReasoningConfig with supported efforts and default
 */
function getModelReasoningConfig(model: string): ModelReasoningConfig {
  for (const { pattern, config } of MODEL_REASONING_CONFIGS) {
    if (pattern.test(model)) {
      return config
    }
  }
  return DEFAULT_REASONING_CONFIG
}

/**
 * Normalize reasoning effort value for a specific model.
 *
 * Different models support different reasoning effort levels:
 * - gpt-5.1: none (default), low, medium, high
 * - gpt-5-pro: high only
 * - gpt-5.1-codex-max+: all values (none, minimal, low, medium, high, xhigh)
 *
 * If the requested effort is not supported by the model, falls back to the model's default.
 *
 * @param model - Model name
 * @param effort - Requested reasoning effort value
 * @returns Normalized effort value, or undefined to use model default
 */
export function normalizeReasoningEffort(
  model: string,
  effort?: string
): ReasoningEffort | undefined {
  if (effort === undefined) {
    return undefined
  }

  const config = getModelReasoningConfig(model)

  // Check if the effort value is valid
  const validEfforts: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  if (!validEfforts.includes(effort as ReasoningEffort)) {
    return config.defaultEffort
  }

  const requestedEffort = effort as ReasoningEffort

  // Check if the model supports this effort level
  if (config.supportedEfforts.includes(requestedEffort)) {
    return requestedEffort
  }

  // Fall back to model default
  return config.defaultEffort
}
