/**
 * Gemini GenerateContent API Types
 * Based on docs/reference/gemini-api-schema.md
 */

// =============================================================================
// Request Types
// =============================================================================

/**
 * Gemini GenerateContent Request
 */
export interface GeminiRequest {
  contents: GeminiContent[]
  systemInstruction?: GeminiSystemInstruction
  tools?: GeminiTool[]
  toolConfig?: GeminiToolConfig
  generationConfig?: GeminiGenerationConfig
  safetySettings?: GeminiSafetySettings[]
  cachedContent?: string
}

/**
 * Content structure (message)
 */
export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

/**
 * System instruction (NOT a string - must be object with parts)
 */
export interface GeminiSystemInstruction {
  parts: Array<{ text: string }>
}

/**
 * Part types
 */
export interface GeminiPart {
  // Text content
  text?: string

  // Inline binary data (images, etc.)
  inlineData?: {
    mimeType: string
    data: string // base64 encoded
  }

  // Cloud storage file reference
  fileData?: {
    mimeType: string
    fileUri: string
  }

  // Function/tool call (model output)
  functionCall?: GeminiFunctionCall

  // Function/tool response (user input)
  functionResponse?: GeminiFunctionResponse

  // Thinking blocks (Gemini 2.5/3)
  thought?: boolean
  thoughtSignature?: string

  // Media resolution hint
  mediaResolution?: 'low' | 'medium' | 'high'
}

/**
 * Function call
 */
export interface GeminiFunctionCall {
  name: string
  args: Record<string, unknown> | string // Support both complete objects and partial JSON strings for streaming
  id?: string // Optional ID for Antigravity
}

/**
 * Function response
 */
export interface GeminiFunctionResponse {
  name: string
  response: Record<string, unknown>
  id?: string // Optional ID for Antigravity
}

/**
 * Tool definition
 */
export interface GeminiTool {
  // Function declarations for custom tools
  functionDeclarations?: GeminiFunctionDeclaration[]

  // Built-in tools
  googleSearch?: Record<string, unknown>
  googleSearchRetrieval?: Record<string, unknown>
  enterpriseWebSearch?: Record<string, unknown>
  urlContext?: Record<string, unknown>
  codeExecution?: Record<string, unknown>
  googleMaps?: Record<string, unknown>
  computerUse?: Record<string, unknown>
}

/**
 * Function declaration
 */
export interface GeminiFunctionDeclaration {
  name: string
  description?: string
  parameters?: GeminiSchema
  parametersJsonSchema?: GeminiSchema // Alternative key name
}

/**
 * Gemini Schema (similar to JSON Schema but with uppercase types)
 */
export interface GeminiSchema {
  type: 'STRING' | 'INTEGER' | 'BOOLEAN' | 'NUMBER' | 'ARRAY' | 'OBJECT'
  format?: 'enum' | 'date-time'
  description?: string
  nullable?: boolean
  items?: GeminiSchema
  properties?: Record<string, GeminiSchema>
  required?: string[]
  enum?: string[]
  anyOf?: GeminiSchema[]
}

/**
 * Tool config
 */
export interface GeminiToolConfig {
  functionCallingConfig?: {
    mode: 'AUTO' | 'ANY' | 'NONE' | 'VALIDATED'
    allowedFunctionNames?: string[]
  }
}

/**
 * Generation config
 */
export interface GeminiGenerationConfig {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  candidateCount?: number
  stopSequences?: string[]
  presencePenalty?: number
  frequencyPenalty?: number
  responseMimeType?: 'text/plain' | 'application/json'
  responseSchema?: GeminiSchema
  seed?: number
  responseLogprobs?: boolean
  logprobs?: number

  // Modality controls
  responseModalities?: ('TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO')[]

  // Thinking configuration
  thinkingConfig?: GeminiThinkingConfig

  // Speech output
  speechConfig?: {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: string }
    }
  }
}

/**
 * Thinking config
 */
export interface GeminiThinkingConfig {
  includeThoughts?: boolean
  // For Gemini 2.5 models - use token budget
  thinkingBudget?: number
  // For Gemini 3 models - use level
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
  // Antigravity Claude-style (snake_case)
  include_thoughts?: boolean
  thinking_budget?: number
}

/**
 * Safety settings
 */
export interface GeminiSafetySettings {
  category: string
  threshold: string
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * Gemini GenerateContent Response
 */
export interface GeminiResponse {
  candidates: GeminiCandidate[]
  usageMetadata?: GeminiUsageMetadata
  promptFeedback?: GeminiPromptFeedback
  responseId?: string
}

/**
 * Candidate
 */
export interface GeminiCandidate {
  index?: number
  content: GeminiContent
  finishReason?: GeminiFinishReason
  safetyRatings?: GeminiSafetyRating[]
  citationMetadata?: GeminiCitationMetadata
  groundingMetadata?: GeminiGroundingMetadata
  urlContextMetadata?: GeminiUrlContextMetadata
  logprobsResult?: unknown
}

/**
 * Finish reason
 */
export type GeminiFinishReason =
  | 'FINISH_REASON_UNSPECIFIED'
  | 'STOP'
  | 'MAX_TOKENS'
  | 'SAFETY'
  | 'RECITATION'
  | 'OTHER'
  | 'BLOCKLIST'
  | 'PROHIBITED_CONTENT'
  | 'SPII'

/**
 * Usage metadata
 */
export interface GeminiUsageMetadata {
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
  thoughtsTokenCount?: number
  cachedContentTokenCount?: number
}

/**
 * Prompt feedback
 */
export interface GeminiPromptFeedback {
  blockReason?: string
  safetyRatings?: GeminiSafetyRating[]
}

/**
 * Safety rating
 */
export interface GeminiSafetyRating {
  category: string
  probability: string
  blocked?: boolean
}

/**
 * Citation metadata
 */
export interface GeminiCitationMetadata {
  citationSources?: Array<{
    startIndex?: number
    endIndex?: number
    uri?: string
    license?: string
  }>
}

/**
 * Grounding metadata
 */
export interface GeminiGroundingMetadata {
  webSearchQueries?: string[]
  groundingChunks?: Array<{
    web?: {
      uri: string
      title?: string
    }
  }>
}

/**
 * URL context metadata
 */
export interface GeminiUrlContextMetadata {
  urlMetadata?: Array<{
    retrievedUrl?: string
    urlRetrievalStatus?: string
  }>
}

// =============================================================================
// Streaming Types
// =============================================================================

/**
 * Gemini Streaming Chunk (same structure as response)
 */
export interface GeminiStreamChunk {
  candidates: GeminiCandidate[]
  usageMetadata?: GeminiUsageMetadata
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if value is a Gemini request
 */
export function isGeminiRequest(value: unknown): value is GeminiRequest {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  // Must have contents array and NOT have messages (which is OpenAI style)
  return Array.isArray(obj.contents) && !('messages' in obj)
}

/**
 * Check if value is a Gemini response
 */
export function isGeminiResponse(value: unknown): value is GeminiResponse {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return Array.isArray(obj.candidates)
}

/**
 * Check if value is Gemini content
 */
export function isGeminiContent(value: unknown): value is GeminiContent {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.role === 'string' &&
    (obj.role === 'user' || obj.role === 'model') &&
    Array.isArray(obj.parts)
  )
}

/**
 * Check if value is a Gemini stream chunk
 */
export function isGeminiStreamChunk(value: unknown): value is GeminiStreamChunk {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return Array.isArray(obj.candidates)
}
