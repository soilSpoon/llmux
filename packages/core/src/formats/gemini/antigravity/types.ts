import type { JsonObject, JsonValue } from '../../../types/json-schema.js'
import type { GeminiSchema } from '../gemini-cli/types.js'

/**
 * Phase 2: Provider Types (Antigravity)
 *
 * Antigravity API를 위한 엄격한 타입 정의입니다.
 * PRD Appendix A/B 및 US-003 준수.
 */

export interface AntigravityMetadata {
  duetProject?: string
  ideType?: string
  platform?: string
  pluginType?: string
  sessionId?: string
  requestId?: string
  conversationId?: string
  userId?: string
  model?: string
  project?: string
  tier?: string
  promptCacheKey?: string
  requestType?: string
  userAgent?: string
  [key: string]: JsonValue | undefined
}

export interface AntigravityProviderRequest {
  project: string
  location?: string
  model: string
  request: AntigravityProviderRequestPayload
  userAgent?: string
  requestId?: string
  metadata?: AntigravityMetadata
}

export interface AntigravityProviderRequestPayload {
  contents: AntigravityContent[]
  system_instruction?: { parts: { text: string }[] }
  systemInstruction?: { parts: { text: string }[] }
  tools?: AntigravityTool[]
  tool_config?: AntigravityToolConfig
  toolConfig?: AntigravityToolConfig
  generation_config?: AntigravityGenerationConfig
  generationConfig?: AntigravityGenerationConfig
  sessionId?: string
}

/**
 * Client (Snake Case) Request Format
 * Used by external clients like Gemini CLI or users manually constructing requests.
 */
export interface AntigravityClientRequest {
  project: string
  model: string
  request: GeminiClientRequest
  user_agent?: string
  request_id?: string
  session_id?: string
  // External metadata might have different casing or fields
  metadata?: JsonObject
}

export interface GeminiClientRequest {
  contents: GeminiClientContent[]
  system_instruction?: { parts: { text: string }[] }
  tools?: GeminiClientTool[]
  tool_config?: AntigravityToolConfig // Usually same structure
  generation_config?: GeminiClientGenerationConfig
  session_id?: string
}

export interface GeminiClientContent {
  role: 'user' | 'model' | 'tool'
  parts: GeminiClientPart[]
}

export interface GeminiClientPart {
  text?: string
  function_call?: { id?: string; name: string; args: JsonObject }
  function_response?: { id: string; name: string; response: Record<string, unknown> }
  thought?: boolean
  thought_signature?: string
  inline_data?: { mime_type: string; data: string }
}

export interface GeminiClientTool {
  function_declarations: AntigravityFunctionDeclaration[]
}

export interface GeminiClientGenerationConfig {
  temperature?: number
  top_p?: number
  top_k?: number
  candidate_count?: number
  max_output_tokens?: number
  stop_sequences?: string[]
  thinking_config?: GeminiClientThinkingConfig
}

export interface GeminiClientThinkingConfig {
  include_thoughts?: boolean
  thinking_budget?: number
  thinking_level?: string
}

// Legacy aliases for backward compatibility
export type AntigravityRequestPayload = AntigravityProviderRequestPayload
export type AntigravityRequest = AntigravityProviderRequest
export type AntigravityWireRequest = AntigravityProviderRequest
export type AntigravityWireRequestPayload = AntigravityProviderRequestPayload

export type AntigravityExternalRequest = AntigravityClientRequest
export type GeminiExternalRequest = GeminiClientRequest
export type GeminiExternalContent = GeminiClientContent
export type GeminiExternalPart = GeminiClientPart
export type GeminiExternalGenerationConfig = GeminiClientGenerationConfig

export const isAntigravityExternalRequest = isAntigravityClientRequest

export interface AntigravityContent {
  role: 'user' | 'model' | 'tool'
  parts: AntigravityPart[]
}

/**
 * AntigravityPart - 모든 가능한 part 필드를 optional로 포함
 * 실제 API에서는 text, functionCall, functionResponse, thought 중 하나만 설정됨
 */
export interface AntigravityPart {
  text?: string
  functionCall?: AntigravityFunctionCall
  functionResponse?: AntigravityFunctionResponse
  thought?: boolean
  thoughtSignature?: string
  inlineData?: { mimeType: string; data: string }
}

export interface AntigravityFunctionCall {
  id: string // PRD: 모든 functionCall은 id 필수
  name: string
  args: JsonObject
}

export interface AntigravityFunctionResponse {
  id: string
  name: string
  response: Record<string, unknown> | JsonObject
}

export interface AntigravityTool {
  functionDeclarations: AntigravityFunctionDeclaration[]
}

export interface AntigravityFunctionDeclaration {
  name: string
  description?: string
  parameters?: GeminiSchema
}

export interface AntigravityToolConfig {
  function_calling_config: {
    mode: 'AUTO' | 'ANY' | 'NONE' | 'VALIDATED' // VALIDATED for Claude
    allowed_function_names?: string[]
  }
}

/**
 * Generation Config - Model Family별로 상이함 (Union Type)
 * PRD US-002, US-003 준수
 */
interface CommonGenerationConfig {
  temperature?: number
  topP?: number
  topK?: number
  candidateCount?: number
  maxOutputTokens?: number
  stopSequences?: string[]
}

export interface ClaudeGenerationConfig extends CommonGenerationConfig {
  thinking_config?: {
    include_thoughts: boolean
    thinking_budget: number
    thinking_level?: string
  }
}

export interface GeminiGenerationConfig extends CommonGenerationConfig {
  thinking_config?: {
    include_thoughts: boolean
    thinking_level?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'
    thinking_budget?: number
  }
  thinkingConfig?: {
    includeThoughts?: boolean
    thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'
    thinkingBudget?: number
  }
}

/**
 * Generation Config - Model Family별로 상이함 (Union Type)
 * 리터럴 할당 시 호환성을 위해 교차 타입을 활용하거나 선택적 필드를 포함합니다.
 */
export type AntigravityGenerationConfig = (
  | ClaudeGenerationConfig
  | GeminiGenerationConfig
  | CommonGenerationConfig
) & {
  thinking_config?: {
    include_thoughts?: boolean
    thinking_budget?: number
    thinking_level?: string
  }
  thinkingConfig?: {
    includeThoughts?: boolean
    thinkingLevel?: string
    thinkingBudget?: number
  }
}

import type { GeminiResponse } from '../shared/response.js'

export interface AntigravityResponse {
  response: GeminiResponse
  traceId?: string
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null
}

/**
 * Type guard for AntigravityResponse
 */
export function isAntigravityResponse(val: unknown): val is AntigravityResponse {
  if (!isRecord(val)) return false
  return val.response !== null && typeof val.response === 'object'
}

/**
 * Type guard for AntigravityProviderRequest
 */
export function isAntigravityProviderRequest(val: unknown): val is AntigravityProviderRequest {
  if (!isRecord(val)) return false

  if (typeof val.project !== 'string') return false
  if (typeof val.model !== 'string') return false

  const req = val.request
  if (!isRecord(req)) return false

  // Internal format uses 'contents'
  // Also ensure no snake_case wrapper fields to avoid ambiguity with ExternalRequest
  return (
    Array.isArray(req.contents) &&
    !('request_id' in val) &&
    !('session_id' in val) &&
    !('user_agent' in val)
  )
}

/**
 * Type guard for AntigravityClientRequest (Snake Case)
 */
export function isAntigravityClientRequest(val: unknown): val is AntigravityClientRequest {
  if (!isRecord(val)) return false

  if (typeof val.project !== 'string') return false
  if (typeof val.model !== 'string') return false

  const req = val.request
  if (!isRecord(req)) return false

  // External format uses 'contents' too, but might have snake_case keys at top level
  // Or check for snake_case fields in wrapper
  const hasSnakeCaseWrapper = 'request_id' in val || 'session_id' in val || 'user_agent' in val

  // Or check inner request for snake_case keys
  const hasSnakeCaseInner = 'generation_config' in req || 'system_instruction' in req

  // If internal format checks failed (e.g. no camelCase specific fields), fallback or explicit check
  return Array.isArray(req.contents) && (hasSnakeCaseWrapper || hasSnakeCaseInner)
}
