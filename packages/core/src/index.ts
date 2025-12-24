/**
 * @llmux/core - LLM Provider Proxy Library
 *
 * Bidirectional transformation between AI providers (OpenAI, Anthropic, Gemini, Antigravity)
 *
 * @example
 * ```typescript
 * import { transformRequest, transformResponse, getProvider } from '@llmux/core'
 *
 * // Transform Gemini request → Anthropic request
 * const anthropicRequest = transformRequest(geminiRequest, {
 *   from: 'gemini',
 *   to: 'anthropic',
 * })
 *
 * // Transform Anthropic response → Gemini response
 * const geminiResponse = transformResponse(anthropicResponse, {
 *   from: 'anthropic',
 *   to: 'gemini',
 * })
 * ```
 */

export { AnthropicProvider } from './providers/anthropic'
export type {
  AnthropicMessage,
  AnthropicRequest,
  AnthropicResponse,
  AnthropicTool,
} from './providers/anthropic/types'
export { AntigravityProvider } from './providers/antigravity'
export type {
  AntigravityInnerRequest,
  AntigravityRequest,
  AntigravityResponse,
} from './providers/antigravity/types'
export type { Provider, ProviderConfig, ProviderName } from './providers/base'
// Provider base types
export { BaseProvider } from './providers/base'
export { GeminiProvider } from './providers/gemini'
export type {
  GeminiContent,
  GeminiRequest,
  GeminiResponse,
  GeminiTool,
} from './providers/gemini/types'
// Provider implementations
export { OpenAIProvider } from './providers/openai'
// Provider-specific types
export type {
  OpenAIMessage,
  OpenAIRequest,
  OpenAIResponse,
  OpenAITool,
} from './providers/openai/types'
// Provider registry
export {
  getProvider,
  getRegisteredProviders,
  hasProvider,
  registerProvider,
} from './providers/registry'
export type { TransformOptions, TransformResponseOptions } from './transform'
// Transform functions
export { transformRequest, transformResponse } from './transform'
// Core types
export type {
  ContentPart,
  GenerationConfig,
  ImageData,
  JSONSchema,
  JSONSchemaProperty,
  RequestMetadata,
  StopReason,
  StreamChunk,
  ThinkingBlock,
  ThinkingConfig,
  ToolCall,
  ToolResult,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedTool,
  UsageInfo,
} from './types'
