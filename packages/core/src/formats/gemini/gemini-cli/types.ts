import type { JsonObject } from '../../../types/json-schema.js'

/**
 * Phase 2: Provider Types (Gemini-CLI)
 *
 * Gemini-CLI를 위한 엄격한 타입 정의입니다.
 * Envelope가 없으며 직접 Payload를 전송합니다.
 */

export interface GeminiCliRequest {
  contents: GeminiCliContent[]
  systemInstruction?: { parts: { text: string }[] } // camelCase commonly used in standard/CLI
  tools?: GeminiCliTool[]
  toolConfig?: GeminiCliToolConfig
  generationConfig?: GeminiCliGenerationConfig
}

export interface GeminiCliContent {
  role: 'user' | 'model' | 'tool'
  parts: GeminiCliPart[]
}

export type GeminiCliPart =
  | { text: string }
  | { functionCall: GeminiCliFunctionCall }
  | { functionResponse: GeminiCliFunctionResponse }
  | { inlineData: { mimeType: string; data: string } }
  | {
      thought: boolean
      text?: string
      thoughtSignature?: string
      /** Antigravity specific snake_case signature */
      thought_signature?: string
      /** Some adapters uses explicit type field */
      type?: string
    }

export interface GeminiCliFunctionCall {
  id?: string // Standard Gemini might be lenient, but we prefer strict
  name: string
  args: JsonObject
}

export interface GeminiCliFunctionResponse {
  id?: string
  name: string
  response: {
    content: JsonObject // Standard Gemini differs slightly in response wrapping
  }
}

export interface GeminiCliTool {
  functionDeclarations?: GeminiCliFunctionDeclaration[]
  googleSearch?: Record<string, unknown>
}

export interface GeminiCliFunctionDeclaration {
  name: string
  description?: string
  parameters?: GeminiSchema
}

export interface GeminiSchema extends JsonObject {
  type?: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT'
  description?: string
  enum?: string[]
  properties?: Record<string, GeminiSchema>
  required?: string[]
  items?: GeminiSchema
  nullable?: boolean
  anyOf?: GeminiSchema[]
}

export interface GeminiCliToolConfig {
  functionCallingConfig: {
    mode: 'AUTO' | 'ANY' | 'NONE' | 'VALIDATED'
    allowedFunctionNames?: string[]
  }
}

export interface GeminiCliGenerationConfig {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  stopSequences?: string[]
  thinkingConfig?: {
    includeThoughts: boolean
    thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'
    thinkingBudget?: number
  }
}
