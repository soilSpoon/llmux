/**
 * OpenAI Responses API Request Transformations
 *
 * Handles transformation between UnifiedRequest and OpenAI Responses API format.
 * Key differences from Chat Completions:
 * - Uses 'input_text' type for text parts in messages
 * - Supports 'instructions' field
 * - Use 'input' instead of 'messages'
 */

import type { UnifiedRequest } from '../../types/unified'
import { transformRequest as transformToOpenAIChat } from '../openai-chat/request'
import type { OpenAIChatRequest } from '../openai-chat/types'
import type {
  OpenAIResponsesAssistantWithContent,
  OpenAIResponsesInputItem,
  OpenAIResponsesRequest,
} from './types'

export { parseRequest } from '../openai-chat/request'

/**
 * Transform a UnifiedRequest into OpenAI Responses API request format.
 *
 * @param request - The UnifiedRequest to transform
 * @param model - The model to use
 * @returns The OpenAI Responses API request
 */
export function transformRequest(request: UnifiedRequest, model?: string): OpenAIResponsesRequest {
  // Start with standard Chat Completions transformation
  const chatRequest = transformToOpenAIChat(
    request,
    model || request.model || 'unknown'
  ) as OpenAIChatRequest

  let instructions: string | undefined
  let messages = chatRequest.messages || []

  // Extract system/developer message to instructions
  if (messages.length > 0) {
    const firstMsg = messages[0]
    if (firstMsg && (firstMsg.role === 'system' || firstMsg.role === 'developer')) {
      if (typeof firstMsg.content === 'string') {
        instructions = firstMsg.content
      } else if (Array.isArray(firstMsg.content)) {
        instructions = firstMsg.content
          .map((p) => (p.type === 'text' || p.type === 'input_text' ? p.text : ''))
          .join('')
      }
      messages = messages.slice(1)
    }
  }

  // Transform messages to input array
  const input: OpenAIResponsesInputItem[] = []

  for (const msg of messages) {
    // 1. Assistant Message with Tool Calls -> separate function_call items
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // If there is also content, add it as a message first
      if (msg.content) {
        const contentParts: Array<{ type: 'output_text'; text: string }> = []
        if (typeof msg.content === 'string') {
          contentParts.push({ type: 'output_text', text: msg.content })
        } else if (Array.isArray(msg.content)) {
          msg.content.forEach((p) => {
            if (p.type === 'text' || p.type === 'input_text') {
              contentParts.push({ type: 'output_text', text: p.text })
            }
          })
        }

        if (contentParts.length > 0) {
          const assistantWithContent: OpenAIResponsesAssistantWithContent = {
            role: 'assistant',
            content: contentParts,
          }
          input.push(assistantWithContent)
        }
      }

      // Add standalone function_call items
      for (const tc of msg.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        })
      }
    }
    // 2. Tool Message -> function_call_output item
    else if (msg.role === 'tool') {
      const toolMsg = msg as { role: 'tool'; content: string; tool_call_id: string }
      input.push({
        type: 'function_call_output',
        call_id: toolMsg.tool_call_id,
        output:
          typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content),
      })
    }
    // 3. Standard User/Assistant Message
    else if (msg.role === 'user' || msg.role === 'assistant') {
      const content = msg.content
      type TransformedContentPart =
        | { type: 'output_text' | 'input_text'; text: string }
        | { type: 'input_image'; image_url: string }
        | unknown

      let newContent: TransformedContentPart[] = []

      if (Array.isArray(content)) {
        newContent = content.map((part) => {
          if (part.type === 'text' || part.type === 'input_text') {
            return {
              type: msg.role === 'assistant' ? 'output_text' : 'input_text',
              text: part.text,
            }
          }
          if (part.type === 'image_url') {
            return {
              type: 'input_image',
              image_url: typeof part.image_url === 'string' ? part.image_url : part.image_url.url,
            }
          }
          return part as TransformedContentPart
        })
      } else if (typeof content === 'string') {
        newContent = [
          {
            type: msg.role === 'assistant' ? 'output_text' : 'input_text',
            text: content,
          },
        ]
      }

      input.push({
        role: msg.role,
        content: newContent as unknown,
      } as OpenAIResponsesInputItem)
    }
  }

  // Construct Result
  const result: OpenAIResponsesRequest = {
    model: chatRequest.model,
    input,
  }

  if (instructions) {
    result.instructions = instructions
  }

  // Copy other parameters
  if (chatRequest.stream !== undefined) result.stream = chatRequest.stream
  if (chatRequest.max_tokens !== undefined) result.max_tokens = chatRequest.max_tokens
  if (chatRequest.temperature !== undefined) result.temperature = chatRequest.temperature
  if (chatRequest.top_p !== undefined) result.top_p = chatRequest.top_p
  if (chatRequest.n !== undefined) result.n = chatRequest.n
  if (chatRequest.stop !== undefined) result.stop = chatRequest.stop
  if (chatRequest.presence_penalty !== undefined)
    result.presence_penalty = chatRequest.presence_penalty
  if (chatRequest.frequency_penalty !== undefined)
    result.frequency_penalty = chatRequest.frequency_penalty
  if (chatRequest.logit_bias !== undefined) result.logit_bias = chatRequest.logit_bias
  if (chatRequest.user !== undefined) result.user = chatRequest.user

  if (chatRequest.reasoning_effort) {
    const resultWithReasoning = result as OpenAIResponsesRequest & {
      reasoning?: { effort: string }
    }
    resultWithReasoning.reasoning = { effort: chatRequest.reasoning_effort }
  }

  return result
}
