/**
 * Antigravity API Wrapper Types
 * Based on docs/reference/antigravity-api-schema.md
 *
 * Antigravity wraps Gemini-style requests/responses with additional metadata
 */

import type { MergeExclusive, Simplify } from 'type-fest'

import type {
  GeminiCandidate,
  GeminiContent,
  GeminiExternalRequest,
  GeminiExternalThinkingConfig,
  GeminiGenerationConfigBase,
  GeminiResponse,
  GeminiThinkingConfig,
  GeminiTool,
  GeminiToolConfig,
  GeminiUsageMetadata,
} from '../gemini/types'

// =============================================================================
// Request Types
// =============================================================================

/**
 * Antigravity Wrapped Request (Use this as Source of Truth)
 * Corresponds to the API spec's root object
 */
export interface AntigravityRequest {
  project: string
  model: string
  request: AntigravityInnerRequest
  userAgent?: string
  requestId?: string

  // Metadata removed from API spec root to fix validation errors
  // metadata?: AntigravityRequestMetadata
}

/**
 * Inner request (Gemini-style with Antigravity extensions)
 * API Spec uses CamelCase for these fields
 */
export interface AntigravityInnerRequest {
  contents: GeminiContent[]
  systemInstruction?: AntigravitySystemInstruction
  tools?: GeminiTool[]
  toolConfig?: GeminiToolConfig
  generationConfig?: AntigravityGenerationConfig

  // Antigravity-specific extensions to the Gemini format
  sessionId?: string
}

/**
 * Antigravity External Request Type (Strict SnakeCase for Network)
 * Formerly known as "WireRequest" or "SnakeRequest"
 * Represents request format from external clients before normalization
 */
export interface AntigravityExternalRequest {
  project: string
  model: string
  request: GeminiExternalRequest
  user_agent?: string
  request_id?: string
  session_id?: string
  metadata?: AntigravityExternalRequestMetadata
}

/**
 * Antigravity request metadata (SnakeCase)
 */
export interface AntigravityExternalRequestMetadata {
  user_role?: string
  request_type?: string
  duet_project?: string
  ide_type?: string
  platform?: string
  plugin_type?: string
  prompt_cache_key?: string
  [key: string]: unknown // Keep for extensibility but prioritize known fields
}

/**
 * Combined thinking config for Antigravity API
 * Alias for backward compatibility or clarity
 */
export type AntigravityThinkingConfig = GeminiThinkingConfig | GeminiExternalThinkingConfig

/**
 * Common type for various Antigravity request formats
 */
export type AnyAntigravityRequest = AntigravityRequest | AntigravityExternalRequest

/**
 * Common type for various Antigravity response formats
 */
export type AnyAntigravityResponse = AntigravityResponse | GeminiResponse

/**
 * Antigravity request metadata (passed in wrapper, not inner request)
 */
export interface AntigravityRequestMetadata {
  // Google Cloud / Duet AI specific
  duetProject?: string
  ideType?: string
  platform?: string
  pluginType?: string

  // Caching
  promptCacheKey?: string

  // Legacy fields mapped here
  userRole?: string
  requestType?: string
}

/**
 * Antigravity System Instruction (supports optional role for Claude)
 */
export interface AntigravitySystemInstruction {
  role?: string
  parts: Array<{ text: string }>
}

/**
 * Generation config with Antigravity extensions
 * Uses MergeExclusive to ensure thinkingConfig (camelCase) and thinking_config (snake_case)
 * are never present at the same time, reflecting the model-specific behavior of the proxy.
 */
export type AntigravityGenerationConfig = Simplify<
  GeminiGenerationConfigBase &
    MergeExclusive<
      { thinkingConfig?: GeminiThinkingConfig },
      { thinking_config?: GeminiExternalThinkingConfig }
    >
>

// Legacy aliases if needed by consumers, otherwise can be removed
export type ClaudeThinkingConfig = GeminiExternalThinkingConfig

// =============================================================================
// Response Types
// =============================================================================

/**
 * Antigravity Wrapped Response
 */
export interface AntigravityResponse {
  response: GeminiResponse
  traceId?: string
}

// =============================================================================
// Streaming Types
// =============================================================================

/**
 * Antigravity Streaming Chunk
 */
export interface AntigravityStreamChunk {
  response: {
    candidates: GeminiCandidate[]
    usageMetadata?: GeminiUsageMetadata
  }
}

/**
 * Antigravity Stream Payload (Internal)
 */
export interface AntigravityStreamPayload {
  response?: GeminiResponse
  candidates?: GeminiCandidate[]
  usageMetadata?: GeminiUsageMetadata
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if value is an Antigravity request (internal format)
 */
export function isAntigravityRequest(value: unknown): value is AntigravityRequest {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  const request = obj.request as Record<string, unknown> | undefined
  const hasSnakeCaseRequest =
    !!request &&
    ('generation_config' in request ||
      'system_instruction' in request ||
      'tool_config' in request ||
      'safety_settings' in request ||
      'cached_content' in request)
  return (
    typeof obj.project === 'string' &&
    typeof obj.model === 'string' &&
    typeof obj.request === 'object' &&
    obj.request !== null &&
    !hasSnakeCaseRequest &&
    !('session_id' in obj) // session_id is a marker for External format
  )
}

/**
 * Check if value is an Antigravity External request (snake_case)
 */
export function isAntigravityExternalRequest(value: unknown): value is AntigravityExternalRequest {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  const request = obj.request as Record<string, unknown> | undefined
  const hasSnakeCaseRequest =
    !!request &&
    ('generation_config' in request ||
      'system_instruction' in request ||
      'tool_config' in request ||
      'safety_settings' in request ||
      'cached_content' in request)
  return (
    typeof obj.project === 'string' &&
    typeof obj.model === 'string' &&
    typeof obj.request === 'object' &&
    obj.request !== null &&
    ('session_id' in obj || 'user_agent' in obj || 'request_id' in obj || hasSnakeCaseRequest) // external format markers
  )
}

/**
 * Check if value is an Antigravity response
 */
export function isAntigravityResponse(value: unknown): value is AntigravityResponse {
  if (!value || typeof value !== 'object') return false
  const obj = value as AntigravityResponse
  return !!obj.response && Array.isArray(obj.response.candidates)
}

/**
 * Check if value is an Antigravity stream chunk
 */
export function isAntigravityStreamChunk(value: unknown): value is AntigravityStreamChunk {
  if (!value || typeof value !== 'object') return false
  const obj = value as AntigravityStreamChunk
  return !!obj.response && Array.isArray(obj.response.candidates)
}

// =============================================================================
// Re-export Gemini types for convenience
// =============================================================================

export type { GeminiContent, GeminiPart } from '../gemini/types'
