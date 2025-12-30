/**
 * OpenAI API Format Detector
 *
 * Detects whether a request is for OpenAI Chat Completions API or Responses API
 * based on the request structure and field presence.
 */

/**
 * OpenAI API format types
 */
export type OpenAIApiFormat = 'completions' | 'responses'

/**
 * Fields that are unique to the Responses API
 */
const RESPONSES_API_FIELDS = [
  'input', // Responses API uses 'input' instead of 'messages'
  'instructions', // System instructions
  'max_output_tokens', // Responses API uses this instead of 'max_tokens'
  'previous_response_id', // For continuation
  'reasoning', // Reasoning/thinking config
  'truncation', // Truncation mode
  'store', // Whether to store the response
] as const

/**
 * Detect whether a request is for OpenAI Chat Completions API or Responses API.
 *
 * Detection priority:
 * 1. If request has 'input' field (without 'messages'), it's Responses API
 * 2. If request has Responses-specific fields (instructions, max_output_tokens, etc.), it's Responses API
 * 3. Otherwise, default to Chat Completions API
 *
 * @param request - The request object to analyze
 * @returns 'responses' or 'completions'
 */
export function detectOpenAIApiFormat(request: unknown): OpenAIApiFormat {
  // Handle null/undefined/non-object
  if (!request || typeof request !== 'object') {
    return 'completions'
  }

  const req = request as Record<string, unknown>

  // Check for Responses API indicators first
  // 'input' is the primary indicator (Responses API doesn't have 'messages')
  if ('input' in req && !('messages' in req)) {
    return 'responses'
  }

  // 'input' takes priority even if 'messages' is present
  if ('input' in req) {
    return 'responses'
  }

  // Check for other Responses API-specific fields
  for (const field of RESPONSES_API_FIELDS) {
    if (field in req) {
      return 'responses'
    }
  }

  // Default to Chat Completions
  return 'completions'
}

/**
 * Check if a request looks like an OpenAI Responses API request
 */
export function isResponsesApiRequest(request: unknown): boolean {
  return detectOpenAIApiFormat(request) === 'responses'
}

/**
 * Check if a request looks like an OpenAI Chat Completions API request
 */
export function isChatCompletionsRequest(request: unknown): boolean {
  return detectOpenAIApiFormat(request) === 'completions'
}
