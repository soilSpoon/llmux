import type { ContentPart, UnifiedMessage } from '../../types/unified'
import { createLogger } from '../../util/logger'
import type {
  OpenAIChatAssistantMessage,
  OpenAIChatContentPart,
  OpenAIChatMessage,
  OpenAIChatTextContent,
  OpenAIChatToolCall,
  OpenAIChatToolMessage,
  OpenAIChatUserMessage,
} from './types'

const logger = createLogger({ module: 'openai-chat-format' })

// =============================================================================
// Message Transformation (Unified -> OpenAI)
// =============================================================================

export function transformMessage(msg: UnifiedMessage): OpenAIChatMessage {
  switch (msg.role) {
    case 'user':
      return transformUserMessage(msg)
    case 'assistant':
      return transformAssistantMessage(msg)
    case 'tool':
      return transformToolMessage(msg)
    default: {
      const _exhaustiveCheck: never = msg.role
      throw new Error(`Unknown message role: ${_exhaustiveCheck}`)
    }
  }
}

function transformUserMessage(msg: UnifiedMessage): OpenAIChatUserMessage {
  const content = transformContent(msg.parts)
  return {
    role: 'user',
    content: simplifyContent(content),
  }
}

function transformAssistantMessage(msg: UnifiedMessage): OpenAIChatAssistantMessage {
  // Include thinking parts as text since OpenAI doesn't support them natively
  const textParts = msg.parts.filter((p) => p.type === 'text' || p.type === 'thinking')
  const toolCallParts = msg.parts.filter((p) => p.type === 'tool_call')

  const result: OpenAIChatAssistantMessage = {
    role: 'assistant',
  }

  // Add text content
  if (textParts.length > 0) {
    const content = transformContent(textParts)
    result.content = simplifyContent(content) as string
  }

  // Add tool calls
  if (toolCallParts.length > 0) {
    result.tool_calls = toolCallParts.map(
      (part): OpenAIChatToolCall => ({
        id: part.toolCall?.id ?? '',
        type: 'function',
        function: {
          name: part.toolCall?.name ?? '',
          arguments:
            typeof part.toolCall?.arguments === 'string'
              ? part.toolCall.arguments
              : JSON.stringify(part.toolCall?.arguments),
        },
      })
    )
  }

  return result
}

function transformToolMessage(msg: UnifiedMessage): OpenAIChatToolMessage {
  const toolResultPart = msg.parts.find((p) => p.type === 'tool_result')
  if (!toolResultPart?.toolResult) {
    throw new Error('Tool message must have a tool_result part')
  }

  return {
    role: 'tool',
    tool_call_id: toolResultPart.toolResult.toolCallId,
    content:
      typeof toolResultPart.toolResult.content === 'string'
        ? toolResultPart.toolResult.content
        : JSON.stringify(toolResultPart.toolResult.content),
  }
}

function transformContent(parts: ContentPart[]): OpenAIChatContentPart[] {
  return parts.map(transformContentPart)
}

function transformContentPart(part: ContentPart): OpenAIChatContentPart {
  switch (part.type) {
    case 'text':
      if (part.text === undefined) {
        throw new Error('Text content part must have text')
      }
      if (part.cacheControl) {
        logger.warn({
          msg: 'Dropping unsupported cache_control in OpenAI transform',
          cacheControl: part.cacheControl,
        })
      }
      return { type: 'text', text: part.text }
    case 'image':
      return transformImageContent(part)
    case 'tool_call':
      // tool_call parts are handled separately in transformAssistantMessage
      // If we reach here, convert to a text representation
      return {
        type: 'text',
        text: `[Tool Call: ${part.toolCall?.name ?? 'unknown'}]`,
      }
    case 'tool_result':
      // tool_result parts should be in 'tool' role messages, handled by transformToolMessage
      // If we reach here (e.g., in user message context), convert to text
      return {
        type: 'text',
        text:
          typeof part.toolResult?.content === 'string'
            ? part.toolResult.content
            : JSON.stringify(part.toolResult?.content ?? ''),
      }
    case 'thinking':
      // Thinking blocks are not directly supported in OpenAI format
      // Convert to a text representation or skip
      return {
        type: 'text',
        text: part.thinking?.text ?? '',
      }
    default:
      throw new Error(`Cannot transform content part type to OpenAI: ${part.type}`)
  }
}

function transformImageContent(part: ContentPart): OpenAIChatContentPart {
  if (!part.image) {
    throw new Error('Image content part must have image data')
  }
  const image = part.image
  let url: string

  if (image.data) {
    url = `data:${image.mimeType};base64,${image.data}`
  } else if (image.url) {
    url = image.url
  } else {
    throw new Error('Image must have either data or url')
  }

  return {
    type: 'image_url',
    image_url: { url },
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function simplifyContent(content: OpenAIChatContentPart[]): string | OpenAIChatContentPart[] {
  // If only one text part, return as string
  const firstPart = content[0]
  if (content.length === 1 && firstPart && firstPart.type === 'text') {
    return (firstPart as OpenAIChatTextContent).text
  }
  return content
}
