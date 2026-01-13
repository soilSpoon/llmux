import type { AmpTarget, ModelMapping } from '../config'
import { KNOWN_PROVIDERS } from '../routing/constants'

/**
 * Parsed model mapping result with optional provider
 */
export interface ParsedModelMapping {
  model: string
  provider?: string
  thinking?: boolean
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
  thinkingBudget?: number
}

/**
 * Parse a model mapping string into components.
 * Supports two formats:
 * 1. "provider/model" (preferred) - e.g., "antigravity/claude-opus-4-5-thinking"
 * 2. "model:provider" (legacy) - Uses the LAST colon as separator
 *
 * Also handles AmpTarget objects directly.
 *
 * Examples:
 * - "antigravity/claude-opus-4-5-thinking" -> { model: "claude-opus-4-5-thinking", provider: "antigravity" }
 * - "openai-web/gpt-5.1" -> { model: "gpt-5.1", provider: "openai-web" }
 * - "gpt-5.1:openai" -> { model: "gpt-5.1", provider: "openai" } (legacy)
 * - "gpt-5.1" -> { model: "gpt-5.1", provider: undefined }
 * - "model:with:colons:openai" -> { model: "model:with:colons", provider: "openai" }
 * - { model: "gpt-5.1", provider: "openai" } -> { model: "gpt-5.1", provider: "openai" }
 */
export function parseModelMapping(mapping: string | AmpTarget): ParsedModelMapping {
  // Handle AmpTarget object directly
  if (typeof mapping === 'object') {
    return {
      model: mapping.model,
      provider: mapping.provider,
      thinking: mapping.thinking,
      thinkingLevel: mapping.thinkingLevel,
      thinkingBudget: mapping.thinkingBudget,
    }
  }

  // Check for provider/model format
  if (mapping.includes('/')) {
    const parts = mapping.split('/')
    // Ensure we only treat it as a provider if it's the first segment and it's a known/valid provider
    // This prevents generic models like "owner/model" from being misparsed
    const providerCandidate = parts[0]
    if (
      providerCandidate &&
      ((KNOWN_PROVIDERS as readonly string[]).includes(providerCandidate) ||
        (providerCandidate.includes('openai') && !providerCandidate.includes('/'))) // loose check for custom openai-compat
    ) {
      const model = mapping.slice(providerCandidate.length + 1)
      return { model, provider: providerCandidate }
    }
  }

  // Legacy "model:provider" format is no longer supported as of 2026-01-08 per user request.
  // We treat everything else as just the model name.

  return { model: mapping, provider: undefined }
}

/**
 * Apply model mapping with shorthand syntax support.
 * Returns both the target model and optional provider.
 *
 * @param model - The input model name
 * @param mappings - Array of model mappings
 * @returns ParsedModelMapping with model and optional provider
 */
export function applyModelMappingV2(
  model: string,
  mappings: ModelMapping[] | undefined
): ParsedModelMapping {
  if (!mappings || mappings.length === 0) {
    return { model }
  }

  const mapping = mappings.find((m) => m.from === model)
  if (!mapping) {
    return { model }
  }

  const to = mapping.to
  const firstTarget = Array.isArray(to) ? to[0] : to

  if (!firstTarget) {
    return { model }
  }

  // Handle object mapping
  if (typeof firstTarget === 'object') {
    return {
      model: firstTarget.model,
      provider: firstTarget.provider,
      thinking: firstTarget.thinking ?? mapping.thinking,
      thinkingLevel: firstTarget.thinkingLevel,
      thinkingBudget: firstTarget.thinkingBudget,
    }
  }

  // Handle string mapping
  const parsed = parseModelMapping(firstTarget)
  return {
    ...parsed,
    thinking: mapping.thinking,
  }
}

/**
 * Legacy function: Apply model mapping and return only the model name.
 * Kept for backward compatibility.
 */
export function applyModelMapping(model: string, mappings: ModelMapping[] | undefined): string {
  if (!mappings || mappings.length === 0) {
    return model
  }

  const mapping = mappings.find((m) => m.from === model)
  if (!mapping) {
    return model
  }

  const to = mapping.to
  const firstTarget = Array.isArray(to) ? to[0] : to

  if (!firstTarget) {
    return model
  }

  if (typeof firstTarget === 'object') {
    return firstTarget.model
  }

  return firstTarget
}
