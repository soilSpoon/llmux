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

export type {
  CacheKey,
  ModelFamily,
  SignatureCacheOptions,
} from './cache/signature'
export {
  createTextHash,
  getModelFamily,
  SignatureCache,
} from './cache/signature'
// AI SDK Provider
export { AiSdkProvider } from './providers/ai-sdk'
export {
  parse as parseAiSdkRequest,
  transform as transformToAiSdk,
} from './providers/ai-sdk/request'
export {
  parseResponse as parseAiSdkResponse,
  transformResponse as transformAiSdkResponse,
} from './providers/ai-sdk/response'
export {
  parseStreamPart as parseAiSdkStreamPart,
  transformStreamPart as transformAiSdkStreamPart,
} from './providers/ai-sdk/streaming'
export type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Text,
  LanguageModelV3ToolCall,
  LanguageModelV3Usage,
} from './providers/ai-sdk/types'
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
export { BaseProvider, isValidProviderName } from './providers/base'
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
// Responses API (OpenAI Responses API support)
export type {
  ChatCompletionChunk,
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  ChatMessage,
  ResponsesAnnotation,
  ResponsesContentPart,
  ResponsesError,
  ResponsesInputMessage,
  ResponsesOutputContent,
  ResponsesOutputItem,
  ResponsesReasoningConfig,
  ResponsesRequest,
  ResponsesResponse,
  ResponsesStreamEvent,
  ResponsesToolChoice,
  ResponsesToolDefinition,
  ResponsesUsage,
} from './responses'
export {
  parseSSELine,
  ResponsesStreamTransformer,
  transformResponsesRequest,
  transformToResponsesResponse,
} from './responses'
export type { TransformOptions, TransformResponseOptions } from './transform'
export { transformRequest, transformResponse } from './transform'
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
// Logging
export { createLogger, logger } from './util/logger'
