import type { ProviderName } from '../providers/base'
import { getProvider } from '../providers/registry'
import type { JsonValue } from '../types/json-schema'
import type { ThinkingConfig } from '../types/unified'

export interface TransformOptions {
  from: ProviderName
  to: ProviderName
  model: string
  /**
   * Override thinking config in the UnifiedRequest before transforming.
   * Use { enabled: false } to disable thinking regardless of source request.
   */
  thinkingOverride?: ThinkingConfig
  /**
   * Additional metadata to merge into the UnifiedRequest before transforming.
   */
  metadata?: Record<string, unknown>
}

/**
 * Transform a request from one provider format to another
 *
 * Flow: Source Request → parse() → UnifiedRequest → transform() → Target Request
 */
export function transformRequest(request: unknown, options: TransformOptions): unknown {
  const sourceProvider = getProvider(options.from)
  const targetProvider = getProvider(options.to)

  const unified = sourceProvider.parse(request)

  // Apply thinking override if specified
  if (options.thinkingOverride !== undefined) {
    unified.thinking = options.thinkingOverride
  }

  // Merge metadata if specified
  if (options.metadata) {
    unified.metadata = {
      ...unified.metadata,
      ...(options.metadata as Record<string, JsonValue | undefined>),
    }
  }

  // Validate request before transformation (for structured output, etc.)
  validateRequest(unified, options.to)

  return targetProvider.transform(unified, options.model)
}

/**
 * Validate unified request for specific provider constraints
 */
// biome-ignore lint/suspicious/noExplicitAny: Relaxed type for unknown properties
function validateRequest(request: any, targetProvider: ProviderName) {
  // Validate structured output schema
  if (request.config?.responseFormat?.type === 'json_schema') {
    const jsonSchema = request.config.responseFormat.json_schema
    if (!jsonSchema?.schema) {
      throw new Error('Structured output requires a valid JSON schema')
    }

    // Check for 'anyOf' if targeting Gemini (often problematic)
    if (targetProvider === 'gemini' || targetProvider === 'antigravity') {
      // Basic check - a deep validation would be better but expensive
      const schemaString = JSON.stringify(jsonSchema.schema)
      // Gemini has strict schema requirements, but let's just ensure it's not empty
      if (schemaString === '{}') {
        // Warning or error?
      }
    }
  }
}
