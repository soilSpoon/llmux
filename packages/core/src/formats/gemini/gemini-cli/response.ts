import type { UnifiedResponse } from '../../../types/unified.js'
import { type GeminiResponse, parseGeminiResponse } from '../shared/response.js'

/**
 * Gemini-CLI Response Adapter
 */
export function parseGeminiCliResponse(response: GeminiResponse): UnifiedResponse {
  return parseGeminiResponse(response)
}
