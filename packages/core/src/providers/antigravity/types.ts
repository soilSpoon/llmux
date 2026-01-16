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
  requestId?: string
  userAgent?: string
  requestType?: string
  userRole?: string
  request: AntigravityInnerRequest

  // Metadata passed through (not injected into inner request)
  metadata?: AntigravityRequestMetadata
}

/**
 * Inner request (Gemini-style with Antigravity extensions)
 */
export interface AntigravityInnerRequest {
  contents: GeminiContent[]
  systemInstruction?: AntigravitySystemInstruction
  tools?: GeminiTool[]
  toolConfig?: GeminiToolConfig
  generationConfig?: AntigravityGenerationConfig

  // Antigravity-specific
  sessionId?: string
}

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
 */
export interface AntigravityGenerationConfig
  extends Omit<GeminiGenerationConfig, 'thinkingConfig'> {
  thinkingConfig?: AntigravityThinkingConfig
}

/**
 * Gemini-style thinking config (camelCase)
 */
export interface GeminiThinkingConfig {
  includeThoughts?: boolean
  thinkingBudget?: number
}

/**
 * Claude-style thinking config via Antigravity (snake_case)
 */
export interface ClaudeThinkingConfig {
  includeThoughts?: boolean
  thinkingBudget?: number
}

/**
 * Combined thinking config for Antigravity API
 */
export type AntigravityThinkingConfig = GeminiThinkingConfig | ClaudeThinkingConfig

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
