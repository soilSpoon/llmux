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
