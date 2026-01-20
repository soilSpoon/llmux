/**
 * Gemini GenerateContent API Types
 * Based on docs/reference/gemini-api-schema.md
 *
 * NOTE: This file is a compatibility layer.
 * The strict source of truth is now in `../../formats/google-gemini/types.ts`.
 */

import type {
  AntigravityProviderRequestPayload as GeminiExternalRequest,
  AntigravityGenerationConfig as GeminiGenerationConfigBase,
} from '../../formats/gemini/antigravity/types.js'

export type { GeminiGenerationConfigBase, GeminiExternalRequest }

import type {
  GeminiCliFunctionCall,
  GeminiCliFunctionDeclaration,
  GeminiCliFunctionResponse,
  GeminiCliContent as GeminiContent,
  GeminiCliPart as GeminiPart,
  GeminiCliRequest as GeminiRequest,
  GeminiSchema,
  GeminiCliTool as GeminiTool,
  GeminiCliToolConfig as GeminiToolConfig,
} from '../../formats/gemini/gemini-cli/types.js'

export type {
  GeminiContent,
  GeminiPart,
  GeminiRequest,
  GeminiTool,
  GeminiToolConfig,
  GeminiCliFunctionCall,
  GeminiCliFunctionResponse,
  GeminiCliFunctionDeclaration,
  GeminiSchema,
}

import type { GeminiCandidate, GeminiResponse } from '../../formats/gemini/shared/response.js'
export type { GeminiCandidate, GeminiResponse }

export type GeminiExternalThinkingConfig = {
  include_thoughts?: boolean
  thinking_budget?: number
  thinking_level?: string
}

export type GeminiThinkingConfig = {
  includeThoughts?: boolean
  thinkingBudget?: number
  thinkingLevel?: string
}

export type GeminiUsageMetadata = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  thoughtsTokenCount?: number
  cachedContentTokenCount?: number
}

export type GeminiStreamChunk = GeminiResponse

import { isRecord } from '../../util/type-guards.js'

// Type Guards for Legacy Support
export function isGeminiRequest(obj: unknown): obj is GeminiRequest {
  return isRecord(obj) && Array.isArray(obj.contents)
}

export function isGeminiResponse(obj: unknown): obj is GeminiResponse {
  return isRecord(obj) && Array.isArray(obj.candidates)
}

export function isGeminiContent(obj: unknown): obj is GeminiContent {
  return (
    isRecord(obj) &&
    (obj.role === 'user' || obj.role === 'model' || obj.role === 'tool') &&
    Array.isArray(obj.parts)
  )
}

export function isGeminiStreamChunk(obj: unknown): obj is GeminiStreamChunk {
  return isGeminiResponse(obj)
}
