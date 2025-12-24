/**
 * Antigravity API Wrapper Types
 * Based on docs/reference/antigravity-api-schema.md
 *
 * Antigravity wraps Gemini-style requests/responses with additional metadata
 */

import type {
  GeminiCandidate,
  GeminiContent,
  GeminiGenerationConfig,
  GeminiResponse,
  GeminiSystemInstruction,
  GeminiTool,
  GeminiToolConfig,
  GeminiUsageMetadata,
} from '../gemini/types'

// =============================================================================
// Request Types
// =============================================================================

/**
 * Antigravity Wrapped Request
 */
export interface AntigravityRequest {
  project: string
  model: string
  userAgent: string
  requestId: string
  request: AntigravityInnerRequest
}

/**
 * Inner request (Gemini-style with Antigravity extensions)
 */
export interface AntigravityInnerRequest {
  contents: GeminiContent[]
  systemInstruction?: GeminiSystemInstruction
  tools?: GeminiTool[]
  toolConfig?: GeminiToolConfig
  generationConfig?: AntigravityGenerationConfig

  // Antigravity-specific
  sessionId?: string
}

/**
 * Generation config with Antigravity extensions
 */
export interface AntigravityGenerationConfig
  extends Omit<GeminiGenerationConfig, 'thinkingConfig'> {
  thinkingConfig?: AntigravityThinkingConfig
}

/**
 * Thinking config for Antigravity (snake_case for Claude models)
 */
export interface AntigravityThinkingConfig {
  // Gemini-style (camelCase)
  includeThoughts?: boolean
  thinkingBudget?: number
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'

  // Claude-style via Antigravity (snake_case)
  include_thoughts?: boolean
  thinking_budget?: number
}

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

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if value is an Antigravity request
 */
export function isAntigravityRequest(value: unknown): value is AntigravityRequest {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.project === 'string' &&
    typeof obj.model === 'string' &&
    typeof obj.userAgent === 'string' &&
    typeof obj.requestId === 'string' &&
    obj.request !== undefined &&
    typeof obj.request === 'object'
  )
}

/**
 * Check if value is an Antigravity response
 */
export function isAntigravityResponse(value: unknown): value is AntigravityResponse {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  // Must have response wrapper with candidates
  if (!obj.response || typeof obj.response !== 'object') return false
  const resp = obj.response as Record<string, unknown>
  return Array.isArray(resp.candidates)
}

/**
 * Check if value is an Antigravity stream chunk
 */
export function isAntigravityStreamChunk(value: unknown): value is AntigravityStreamChunk {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  // Must have response wrapper with candidates
  if (!obj.response || typeof obj.response !== 'object') return false
  const resp = obj.response as Record<string, unknown>
  return Array.isArray(resp.candidates)
}

// =============================================================================
// Re-export Gemini types for convenience
// =============================================================================

export type { GeminiContent, GeminiPart } from '../gemini/types'
