import { type GeminiResponseShape, type ProviderName, transformResponse } from '@llmux/core'

// Re-export types from core for backward compatibility
export type { GeminiResponseShape }

export function transformGeminiSseResponse(
  finalResponse: GeminiResponseShape,
  currentProvider: ProviderName,
  targetFormat: ProviderName
): unknown {
  return transformResponse({ response: finalResponse }, { from: currentProvider, to: targetFormat })
}
