import type { UnifiedResponse } from '../../../types/unified.js'
import { type GeminiResponse, parseGeminiResponse } from '../shared/response.js'
import type { AntigravityResponse } from './types.js'
import { isAntigravityResponse } from './types.js'

export function parseAntigravityResponse(
  response: AntigravityResponse | GeminiResponse | unknown
): UnifiedResponse {
  if (isAntigravityResponse(response)) {
    return parseGeminiResponse(response.response)
  }

  // Assume it's a GeminiResponse if it's not wrapped.
  // parseGeminiResponse handles validation of candidates internally.
  return parseGeminiResponse(response as GeminiResponse)
}
