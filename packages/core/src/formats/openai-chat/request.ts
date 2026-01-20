/**
 * OpenAI Chat Format - Request Transformation
 *
 * Handles bidirectional transformation between OpenAI Chat request format and UnifiedRequest.
 * This module is self-contained within the formats layer (no imports from providers/).
 */

import type { UnifiedRequest } from '../../types/unified'
import { normalizeToolHistory } from '../../util/tool-history'
import {
  applyThinkingConfig,
  isGLMModel,
  isReasoningModel,
  parseConfig,
  parseGLMThinking,
  transformToGLMThinking,
} from './config'
import { extractTextContent, parseMessage, reconstructFlattenedToolCalls } from './message-parser'
import { transformMessage } from './message-transformer'
import { parseTool, transformTool, transformToolChoice } from './tools'
import type { OpenAIChatMessage, OpenAIChatRequest } from './types'

/**
 * Parse an OpenAI Chat request into UnifiedRequest format.
 */
export function parseRequest(request: OpenAIChatRequest): UnifiedRequest {
  const result: UnifiedRequest = {
    messages: [],
    metadata: {
      model: request.model,
    },
  }

  // Extract user and potential cache key
  if (request.user) {
    if (result.metadata) {
      result.metadata.user = request.user
    }
  }

  let systemContent: string | undefined
  // Fallback to input if messages is empty (handle both undefined and empty array)
  const messages =
    Array.isArray(request.messages) && request.messages.length > 0
      ? request.messages
      : request.input || []

  // Reconstruct messages if tool calls are flattened into the array
  // (only needed when using input field with Responses API format)
  const hasFlattenedToolCalls = messages.some(
    (msg) => msg && typeof msg === 'object' && !('role' in msg)
  )
  const reconstructedMessages: OpenAIChatMessage[] = hasFlattenedToolCalls
    ? reconstructFlattenedToolCalls(messages)
    : messages.filter((msg) => msg && typeof msg === 'object' && 'role' in msg)

  for (const msg of reconstructedMessages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      // Extract system/developer message content
      systemContent = extractTextContent(msg.content)
    } else {
      const parsed = parseMessage(msg)
      if (parsed) {
        result.messages.push(parsed)
      }
    }
  }

  if (systemContent) {
    result.system = systemContent
  }

  // Parse generation config
  const config = parseConfig(request)
  if (Object.keys(config).length > 0) {
    result.config = config
  }

  // Parse tools
  if (request.tools && request.tools.length > 0) {
    result.tools = request.tools.map(parseTool)
  }

  // Parse thinking config from OpenAI reasoning_effort
  if (request.reasoning_effort) {
    result.thinking = {
      enabled: request.reasoning_effort !== 'none',
      effort: request.reasoning_effort,
    }
  }

  // Parse thinking config
  if (request.thinking) {
    result.thinking = parseGLMThinking(request.thinking)
  }

  // Preserve stream flag
  if (request.stream !== undefined) {
    result.stream = request.stream
  }

  return result
}

/**
 * Transform a UnifiedRequest into OpenAI Chat request format.
 */
export function transformRequest(request: UnifiedRequest, model: string): OpenAIChatRequest {
  const result: OpenAIChatRequest = {
    model,
    messages: [],
    stream: request.stream,
  }

  const isReasoning = isReasoningModel(model)

  // Add system messages
  // Prefer systemBlocks (multiple blocks) over single system string to preserve structure
  if (request.systemBlocks && request.systemBlocks.length > 0) {
    if (!result.messages) result.messages = []
    for (const block of request.systemBlocks) {
      result.messages.push({
        role: isReasoning ? 'developer' : 'system',
        content: block.text,
      })
    }
  } else if (request.system) {
    if (!result.messages) result.messages = []
    result.messages.push({
      role: isReasoning ? 'developer' : 'system',
      content: request.system,
    })
  }

  // Transform messages, extracting tool_result parts from user messages as separate tool messages
  const normalizedMessages = normalizeToolHistory(request.messages)
  for (const msg of normalizedMessages) {
    if (!result.messages) result.messages = []
    if (msg.role === 'user') {
      // Check for tool_result parts in user message and extract them as separate tool messages
      const toolResultParts = msg.parts.filter((p) => p.type === 'tool_result')
      const otherParts = msg.parts.filter((p) => p.type !== 'tool_result')

      // Add tool messages for each tool_result part (before the user message)
      for (const part of toolResultParts) {
        if (part.toolResult) {
          result.messages.push({
            role: 'tool',
            tool_call_id: part.toolResult.toolCallId,
            content:
              typeof part.toolResult.content === 'string'
                ? part.toolResult.content
                : JSON.stringify(part.toolResult.content ?? ''),
          })
        }
      }

      // Add the user message with remaining parts (if any)
      if (otherParts.length > 0) {
        result.messages.push(transformMessage({ ...msg, parts: otherParts }))
      }
    } else {
      result.messages.push(transformMessage(msg))
    }
  }

  // Transform generation config
  if (request.config) {
    if (request.config.maxTokens !== undefined) {
      if (isReasoning) {
        // O-series models use max_completion_tokens instead of max_tokens
        result.max_completion_tokens = request.config.maxTokens
      } else {
        result.max_tokens = request.config.maxTokens
      }
    }
    // O-series models don't support temperature and top_p
    if (!isReasoning) {
      if (request.config.temperature !== undefined) {
        result.temperature = request.config.temperature
      }
      if (request.config.topP !== undefined) {
        result.top_p = request.config.topP
      }
    }
    if (request.config.stopSequences && request.config.stopSequences.length > 0) {
      result.stop = request.config.stopSequences
    }

    // Map extended fields
    if (request.config.logprobs !== undefined) {
      result.logprobs = !!request.config.logprobs
      if (typeof request.config.logprobs === 'number') {
        result.top_logprobs = request.config.logprobs
      }
    }
    if (request.config.serviceTier) {
      result.service_tier = request.config.serviceTier
    }
    if (request.config.parallelToolCalls !== undefined) {
      result.parallel_tool_calls = request.config.parallelToolCalls
    }
    if (request.config.responseFormat) {
      // biome-ignore lint/suspicious/noExplicitAny: Relaxed type for unknown properties
      const format = request.config.responseFormat as any
      if (format === 'json') {
        result.response_format = { type: 'json_object' }
      } else if (typeof request.config.responseFormat === 'object') {
        const format = request.config.responseFormat
        if ('type' in format) {
          if (format.type === 'text' || format.type === 'json_object') {
            result.response_format = { type: format.type }
          } else if (format.type === 'json_schema' && 'json_schema' in format) {
            // Pass through JSON schema
            result.response_format = format as unknown as {
              type: 'json_schema'
              json_schema: {
                name: string
                strict?: boolean
                schema?: Record<string, unknown>
                description?: string
              }
            }
          }
        } else {
          // Fallback for Record<string, unknown>
          // biome-ignore lint/suspicious/noExplicitAny: Relaxed type for unknown properties
          result.response_format = format as any
        }
      }
    }
  }

  // Apply thinking config (inline - no dependency on transform/thinking.ts)
  applyThinkingConfig(request, model, result)

  // Transform tools
  if (request.tools && request.tools.length > 0) {
    result.tools = request.tools.map(transformTool)
  }

  // Transform tool_choice
  const toolChoice = transformToolChoice(request.toolChoice)
  if (toolChoice) {
    result.tool_choice = toolChoice
  }

  // Transform thinking config
  if (isGLMModel(model)) {
    // GLM 4.7 has thinking enabled by default, so we need to explicitly disable it
    if (request.thinking?.enabled === true) {
      result.thinking = transformToGLMThinking(request.thinking)
    } else {
      // Explicitly disable thinking for GLM models when not enabled
      result.thinking = { type: 'disabled' }
    }
  } else if (request.thinking) {
    if (isReasoningModel(model)) {
      // O-series models use reasoning_effort format
      result.reasoning_effort = request.thinking.effort || 'medium'
    } else {
      // Other models use reasoning_effort as well
      if (request.thinking.enabled) {
        result.reasoning_effort = request.thinking.effort || 'medium'
      } else {
        result.reasoning_effort = 'none'
      }
    }
  }

  // Transform metadata fields
  if (request.metadata) {
    if (request.metadata.serviceTier !== undefined) {
      result.service_tier = request.metadata.serviceTier as string
    }
    if (request.metadata.parallelToolCalls !== undefined) {
      result.parallel_tool_calls = request.metadata.parallelToolCalls as boolean
    }
  }

  return result
}
