import type { AmpModelMapping, AmpTarget } from '../config'

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
 * Parse a shorthand mapping string "model:provider" into components.
 * Uses the LAST colon as the separator to allow models with colons in their names.
 * Also handles AmpTarget objects directly.
 *
 * Examples:
 * - "gpt-5.1:openai" -> { model: "gpt-5.1", provider: "openai" }
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

  const lastColonIndex = mapping.lastIndexOf(':')

  // No colon found, or colon is at the end (e.g., "model:")
  if (lastColonIndex === -1 || lastColonIndex === mapping.length - 1) {
    return { model: mapping.replace(/:$/, ''), provider: undefined }
  }

  const model = mapping.slice(0, lastColonIndex)
  const provider = mapping.slice(lastColonIndex + 1)

  return { model, provider }
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
  mappings: AmpModelMapping[] | undefined
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
export function applyModelMapping(model: string, mappings: AmpModelMapping[] | undefined): string {
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
