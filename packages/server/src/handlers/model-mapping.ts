import type { AmpModelMapping } from '../config'

/**
 * Parsed model mapping result with optional provider
 */
export interface ParsedModelMapping {
  model: string
  provider?: string
}

/**
 * Parse a shorthand mapping string "model:provider" into components.
 * Uses the LAST colon as the separator to allow models with colons in their names.
 *
 * Examples:
 * - "gpt-5.1:openai" -> { model: "gpt-5.1", provider: "openai" }
 * - "gpt-5.1" -> { model: "gpt-5.1", provider: undefined }
 * - "model:with:colons:openai" -> { model: "model:with:colons", provider: "openai" }
 */
export function parseModelMapping(mapping: string): ParsedModelMapping {
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
  const targetString = Array.isArray(to) ? (to[0] ?? model) : to

  return parseModelMapping(targetString)
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
  if (Array.isArray(to)) {
    return to.length > 0 ? (to[0] ?? model) : model
  }

  return to
}
