/**
 * Format Registry
 *
 * Central registry for all schema formats. Provides lookup by FormatId.
 *
 * Usage:
 *   import { getFormat } from './formats/registry'
 *   const format = getFormat('openai-chat')
 *   format.parseRequest(wireRequest)
 */

import { AnthropicMessagesFormat } from './anthropic-messages'
import type { FormatId, SchemaFormat } from './base'
import { GoogleGeminiFormat } from './google-gemini/index'
import { OpenAIChatFormat } from './openai-chat'
import { OpenAIResponsesFormat } from './openai-responses'

/**
 * Registry mapping FormatId to SchemaFormat implementation.
 * All formats are instantiated eagerly for simplicity.
 */
export const FORMAT_REGISTRY: Record<FormatId, SchemaFormat> = {
  'openai-chat': OpenAIChatFormat,
  'openai-responses': OpenAIResponsesFormat,
  'anthropic-messages': AnthropicMessagesFormat,
  'google-gemini': GoogleGeminiFormat,
}

/**
 * Get a SchemaFormat by its FormatId.
 *
 * @param id - The format identifier
 * @returns The corresponding SchemaFormat implementation
 * @throws Error if the format is not registered
 */
export function getFormat(id: FormatId): SchemaFormat {
  const format = FORMAT_REGISTRY[id]
  if (!format) {
    throw new Error(`Unknown format: ${id}`)
  }
  return format
}
