/**
 * OpenAI Responses API Response Transformations
 *
 * Handles transformation between OpenAI Responses API response and UnifiedResponse.
 */

import type { UnifiedResponse } from '../../types/unified'
import type { ResponsesOutputItem, ResponsesResponse } from './types'

/**
 * Parse an OpenAI Responses API response into UnifiedResponse format.
 */
export function parseResponse(response: unknown): UnifiedResponse {
  const responsesResponse = response as ResponsesResponse

  if (responsesResponse.object !== 'response') {
    // If it looks like a Chat Completion, try to parse it as such (fallback)
    const asChat = response as ResponsesResponse & { object?: string; choices?: unknown[] }
    if (asChat.object === 'chat.completion' && Array.isArray(asChat.choices)) {
      // Inline fallback to chat completion parsing logic to avoid circular deps or complex imports
      // Ideally we should import from openai-chat/response but let's handle the basics here or re-import if safe
      // Re-using the logic from openai-chat is better if we can import it.
      // The original file imported it, so let's import it but use it ONLY as fallback
      return require('../openai-chat/response').parseResponse(asChat)
    }
    // If output is missing but object is response, maybe empty?
    if (!Array.isArray(responsesResponse.output)) {
      throw new Error('Invalid OpenAI Responses API response: missing output array')
    }
  }

  const result: UnifiedResponse = {
    id: responsesResponse.id || `resp_${Date.now()}`,
    content: [],
    stopReason: null, // Responses API doesn't have a clear stop reason per-se in the main object, mostly implicitly 'completed'
    model: typeof responsesResponse.model === 'string' ? responsesResponse.model : 'unknown',
  }

  // Parse output items
  if (responsesResponse.output) {
    for (const item of responsesResponse.output) {
      if (item.type === 'message' && item.content) {
        for (const part of item.content) {
          if (part.type === 'output_text' && part.text) {
            result.content.push({
              type: 'text',
              text: part.text,
            })
          }
        }
      } else if (item.type === 'function_call') {
        result.content.push({
          type: 'tool_call',
          toolCall: {
            id: item.call_id || item.id || '',
            name: item.name || '',
            arguments: safeJsonParse(item.arguments || '{}'),
          },
        })
      } else if (item.type === 'reasoning' && item.summary) {
        if (!result.thinking) {
          result.thinking = []
        }
        for (const part of item.summary) {
          if (part.type === 'summary_text' && part.text) {
            result.thinking.push({
              text: part.text,
            })
          }
        }
      }
    }
  }

  // Parse status to stop reason
  if (responsesResponse.status === 'completed') {
    result.stopReason = 'end_turn'
  } else if (responsesResponse.status === 'failed') {
    result.stopReason = 'error'
  }

  // Preserve full metadata for lossless round-trip
  result.metadata = {
    ...responsesResponse,
    // Ensure we have camelCase versions for internal use if needed,
    // but keeping everything from responsesResponse allows lossless roundtrip
    createdAt: responsesResponse.created_at,
    responseId: responsesResponse.id,
  }

  // Parse usage
  if (responsesResponse.usage) {
    result.usage = {
      inputTokens: responsesResponse.usage.input_tokens || 0,
      outputTokens: responsesResponse.usage.output_tokens || 0,
      totalTokens: responsesResponse.usage.total_tokens || 0,
      thinkingTokens: responsesResponse.usage.output_tokens_details?.reasoning_tokens,
    }
  }

  return result
}

/**
 * Transform a UnifiedResponse into OpenAI Responses API response format.
 */
export function transformResponse(response: UnifiedResponse): ResponsesResponse {
  const output: ResponsesOutputItem[] = []

  // 1. Transform text content
  const textParts = response.content.filter((p) => p.type === 'text')
  if (textParts.length > 0) {
    output.push({
      type: 'message',
      role: 'assistant',
      content: textParts.map((p) => ({
        type: 'output_text',
        text: p.text || '',
      })),
    })
  }

  // 2. Transform tool calls
  const toolCalls = response.content.filter((p) => p.type === 'tool_call')
  for (const part of toolCalls) {
    if (part.toolCall) {
      output.push({
        type: 'function_call',
        id: part.toolCall.id,
        call_id: part.toolCall.id, // Spec requires call_id
        name: part.toolCall.name,
        arguments:
          typeof part.toolCall.arguments === 'string'
            ? part.toolCall.arguments
            : JSON.stringify(part.toolCall.arguments),
      })
    }
  }

  // 3. Transform thinking
  if (response.thinking && response.thinking.length > 0) {
    output.push({
      type: 'reasoning',
      id: `reasoning_${Date.now()}`,
      summary: response.thinking.map((t) => ({
        type: 'summary_text',
        text: t.text,
      })),
    })
  }

  // 4. Map stop reason to status
  let status: ResponsesResponse['status'] = response.metadata?.status || 'completed'
  if (response.stopReason === 'error') {
    status = 'failed'
  }

  // Construct response
  const result: ResponsesResponse = {
    // Restore all original fields from metadata (snake_case)
    ...response.metadata,
    // Priority: metadata.id -> response.id -> generated id
    id: response.metadata?.id || response.id,
    object: response.metadata?.object || 'response',
    status: status,
    model: response.model || response.metadata?.model || '',
    output,
  }

  // Ensure these are present if they were in metadata
  if (response.metadata?.created_at) {
    result.created_at = response.metadata.created_at
  }

  if (response.usage) {
    result.usage = {
      input_tokens: response.usage.inputTokens,
      output_tokens: response.usage.outputTokens,
      total_tokens:
        response.usage.totalTokens ?? response.usage.inputTokens + response.usage.outputTokens,
    }
    if (response.usage.thinkingTokens) {
      result.usage.output_tokens_details = {
        reasoning_tokens: response.usage.thinkingTokens,
      }
    }
  }

  return result
}

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}
