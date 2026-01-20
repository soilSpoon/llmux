import type { JsonObject } from '../../types/json'
import type { ContentPart, UnifiedMessage } from '../../types/unified'
import type {
  OpenAIChatAssistantMessage,
  OpenAIChatContentPart,
  OpenAIChatFlattenedToolCall,
  OpenAIChatMessage,
  OpenAIChatToolMessage,
  OpenAIChatUserMessage,
} from './types'

// =============================================================================
// Message Reconstruction
// =============================================================================

/**
 * Type guard to check if an object is a flattened tool call
 */
function isFlattenedToolCall(obj: unknown): obj is OpenAIChatFlattenedToolCall {
  if (typeof obj !== 'object' || obj === null) return false
  const item = obj as Record<string, unknown>
  return (
    item.type === 'function' &&
    typeof item.name === 'string' &&
    typeof item.call_id === 'string' &&
    typeof item.arguments === 'string'
  )
}

/**
 * Type guard to check if an object is an OpenAI Chat message
 */
function isOpenAIChatMessage(obj: unknown): obj is OpenAIChatMessage {
  if (typeof obj !== 'object' || obj === null) return false
  const item = obj as Record<string, unknown>
  return typeof item.role === 'string'
}

/**
 * Reconstructs messages when tool calls are flattened into the message array.
 * Some APIs (like Responses API) flatten tool calls, so we need to regroup them.
 */
export function reconstructFlattenedToolCalls(messages: unknown[]): OpenAIChatMessage[] {
  if (!Array.isArray(messages)) return []

  const reconstructed: OpenAIChatMessage[] = []
  let currentAssistantMessage: OpenAIChatAssistantMessage | null = null
  let lastProcessedAssistantIndex = -1

  for (const msg of messages) {
    // Skip null/undefined
    if (!msg) continue

    // Check if this is a flattened tool call
    if (isFlattenedToolCall(msg)) {
      if (!currentAssistantMessage && lastProcessedAssistantIndex >= 0) {
        // We have a previous assistant message - use it
        currentAssistantMessage = reconstructed[
          lastProcessedAssistantIndex
        ] as OpenAIChatAssistantMessage
      }

      if (!currentAssistantMessage) {
        // Create new assistant message with tool calls
        currentAssistantMessage = {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: msg.call_id,
              type: 'function',
              function: {
                name: msg.name,
                arguments: msg.arguments,
              },
            },
          ],
        }
        reconstructed.push(currentAssistantMessage)
      } else {
        // Add to existing assistant message
        if (!currentAssistantMessage.tool_calls) {
          currentAssistantMessage.tool_calls = []
        }
        currentAssistantMessage.tool_calls.push({
          id: msg.call_id,
          type: 'function',
          function: {
            name: msg.name,
            arguments: msg.arguments,
          },
        })
      }
      continue
    }

    // Check if this is a regular message with role
    if (isOpenAIChatMessage(msg)) {
      // If this is a non-assistant message, clear current assistant tracking
      if (msg.role !== 'assistant') {
        currentAssistantMessage = null
      }

      reconstructed.push(msg)

      // Track assistant messages for grouping subsequent tool calls
      if (msg.role === 'assistant') {
        lastProcessedAssistantIndex = reconstructed.length - 1
        currentAssistantMessage = msg
      }
    }
  }

  return reconstructed
}

// =============================================================================
// Message Parsing (OpenAI -> Unified)
// =============================================================================

export function parseMessage(msg: OpenAIChatMessage): UnifiedMessage | null {
  switch (msg.role) {
    case 'user':
      return parseUserMessage(msg)
    case 'assistant':
      return parseAssistantMessage(msg)
    case 'tool':
      return parseToolMessage(msg)
    case 'system':
    case 'developer':
      throw new Error('System/Developer messages should be handled separately')
    default: {
      // Ignore unknown roles per spec (silent stripping)
      return null
    }
  }
}

function parseUserMessage(msg: OpenAIChatUserMessage): UnifiedMessage {
  return {
    role: 'user',
    parts: parseContent(msg.content),
  }
}

function parseAssistantMessage(msg: OpenAIChatAssistantMessage): UnifiedMessage {
  const parts: ContentPart[] = []

  // Add text content if present
  if (msg.content) {
    const textParts = parseContent(msg.content)
    parts.push(...textParts)
  }

  // Add tool calls if present
  if (msg.tool_calls) {
    for (const toolCall of msg.tool_calls) {
      parts.push({
        type: 'tool_call',
        toolCall: {
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: safeJsonParse(toolCall.function.arguments),
        },
      })
    }
  }

  return {
    role: 'assistant',
    parts,
  }
}

function parseToolMessage(msg: OpenAIChatToolMessage): UnifiedMessage {
  return {
    role: 'tool',
    parts: [
      {
        type: 'tool_result',
        toolResult: {
          toolCallId: msg.tool_call_id,
          content: extractTextContent(msg.content),
        },
      },
    ],
  }
}

function parseContent(content: string | OpenAIChatContentPart[]): ContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }

  return content.map(parseContentPart)
}

function parseContentPart(part: OpenAIChatContentPart): ContentPart {
  switch (part.type) {
    case 'text':
    case 'input_text':
      return { type: 'text', text: part.text }
    case 'image_url':
      return parseImageContent(part)
    default: {
      const _exhaustiveCheck: never = part
      throw new Error(
        `Unknown content part type: ${(_exhaustiveCheck as OpenAIChatContentPart).type}`
      )
    }
  }
}

function parseImageContent(part: {
  type: 'image_url'
  image_url: string | { url: string; detail?: string }
}): ContentPart {
  const url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url

  // Check if it's a data URL
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/)
    if (match?.[1] && match[2]) {
      return {
        type: 'image',
        image: {
          mimeType: match[1],
          data: match[2],
        },
      }
    }
  }

  // Regular URL - infer mime type from extension
  const mimeType = inferMimeTypeFromUrl(url)
  return {
    type: 'image',
    image: {
      mimeType,
      url,
    },
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

export function extractTextContent(content: string | OpenAIChatContentPart[]): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .filter((p) => p.type === 'text' || p.type === 'input_text')
    .map((p) => (p as { type: 'text' | 'input_text'; text: string }).text)
    .join('\n')
}

function safeJsonParse(str: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(str)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonObject
    }
    return {}
  } catch {
    return {}
  }
}

function inferMimeTypeFromUrl(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0]

  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  }

  return mimeTypes[ext || ''] || 'image/jpeg'
}
