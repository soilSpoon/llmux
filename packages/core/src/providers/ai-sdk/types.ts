/**
 * AI SDK Provider Types
 *
 * Re-exports from @ai-sdk/provider for convenience
 * and defines llmux-specific adapter types.
 *
 * @see https://github.com/vercel/ai/tree/main/packages/provider
 */

// Re-export AI SDK types directly from the package
export type {
  JSONSchema7,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3DataContent,
  LanguageModelV3File,
  LanguageModelV3FilePart,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3Reasoning,
  LanguageModelV3ReasoningPart,
  LanguageModelV3ResponseMetadata,
  LanguageModelV3Source,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Text,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolChoice,
  LanguageModelV3ToolResult,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3ProviderOptions,
  SharedV3Warning,
} from '@ai-sdk/provider'

// =============================================================================
// Type Guards
// =============================================================================

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FilePart,
  LanguageModelV3FunctionTool,
  LanguageModelV3ReasoningPart,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
} from '@ai-sdk/provider'

/**
 * Check if value is an AI SDK LanguageModelV3CallOptions
 */
export function isAiSdkCallOptions(value: unknown): value is LanguageModelV3CallOptions {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return Array.isArray(obj.prompt)
}

/**
 * Check if a message part is a text part
 */
export function isTextPart(part: unknown): part is LanguageModelV3TextPart {
  return typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text'
}

/**
 * Check if a message part is a file part
 */
export function isFilePart(part: unknown): part is LanguageModelV3FilePart {
  return typeof part === 'object' && part !== null && (part as { type?: string }).type === 'file'
}

/**
 * Check if a message part is a tool call part
 */
export function isToolCallPart(part: unknown): part is LanguageModelV3ToolCallPart {
  return (
    typeof part === 'object' && part !== null && (part as { type?: string }).type === 'tool-call'
  )
}

/**
 * Check if a message part is a reasoning part
 */
export function isReasoningPart(part: unknown): part is LanguageModelV3ReasoningPart {
  return (
    typeof part === 'object' && part !== null && (part as { type?: string }).type === 'reasoning'
  )
}

/**
 * Check if a message part is a tool result part
 */
export function isToolResultPart(part: unknown): part is LanguageModelV3ToolResultPart {
  return (
    typeof part === 'object' && part !== null && (part as { type?: string }).type === 'tool-result'
  )
}

/**
 * Check if content is LanguageModelV3Content text
 */
export function isTextContent(
  content: LanguageModelV3Content
): content is { type: 'text'; text: string } {
  return content.type === 'text'
}

/**
 * Check if content is LanguageModelV3Content reasoning
 */
export function isReasoningContent(
  content: LanguageModelV3Content
): content is { type: 'reasoning'; text: string } {
  return content.type === 'reasoning'
}

/**
 * Check if content is LanguageModelV3Content file
 */
export function isFileContent(
  content: LanguageModelV3Content
): content is { type: 'file'; mediaType: string; data: string | Uint8Array } {
  return content.type === 'file'
}

/**
 * Check if content is LanguageModelV3Content tool-call
 */
export function isToolCallContent(
  content: LanguageModelV3Content
): content is { type: 'tool-call'; toolCallId: string; toolName: string; input: string } {
  return content.type === 'tool-call'
}

/**
 * Check if tool is a function tool
 */
export function isFunctionTool(tool: unknown): tool is LanguageModelV3FunctionTool {
  return (
    typeof tool === 'object' && tool !== null && (tool as { type?: string }).type === 'function'
  )
}
