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

// Transform functions
export { transformRequest, transformResponse } from "./transform";
export type { TransformOptions, TransformResponseOptions } from "./transform";

// Provider registry
export {
  getProvider,
  registerProvider,
  hasProvider,
  getRegisteredProviders,
} from "./providers/registry";

// Provider base types
export { BaseProvider } from "./providers/base";
export type { Provider, ProviderName, ProviderConfig } from "./providers/base";

// Core types
export type {
  UnifiedRequest,
  UnifiedResponse,
  UnifiedMessage,
  UnifiedTool,
  ContentPart,
  ThinkingBlock,
  ThinkingConfig,
  GenerationConfig,
  ToolCall,
  ToolResult,
  ImageData,
  UsageInfo,
  StopReason,
  StreamChunk,
  JSONSchema,
  JSONSchemaProperty,
  RequestMetadata,
} from "./types";
