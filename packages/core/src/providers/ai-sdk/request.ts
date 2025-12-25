/**
 * AI SDK Request Transformations
 *
 * Handles bidirectional transformation between AI SDK LanguageModelV3CallOptions
 * and UnifiedRequest.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FilePart,
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ReasoningPart,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
} from '@ai-sdk/provider'
import type {
  ContentPart,
  JSONSchema,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedTool,
} from '../../types/unified'
import {
  isFilePart,
  isFunctionTool,
  isReasoningPart,
  isTextPart,
  isToolCallPart,
  isToolResultPart,
} from './types'

// =============================================================================
// Parse: AI SDK → Unified
// =============================================================================

/**
 * Parse AI SDK LanguageModelV3CallOptions into UnifiedRequest format.
 *
 * @param options - The AI SDK call options to parse
 * @returns The parsed UnifiedRequest
 */
export function parse(options: LanguageModelV3CallOptions): UnifiedRequest {
  const result: UnifiedRequest = {
    messages: [],
  }

  let systemContent: string | undefined

  for (const msg of options.prompt) {
    if (msg.role === 'system') {
      // Extract system message content
      systemContent = msg.content
    } else {
      result.messages.push(parseMessage(msg))
    }
  }

  if (systemContent) {
    result.system = systemContent
  }

  // Parse generation config
  const config = parseConfig(options)
  if (Object.keys(config).length > 0) {
    result.config = config
  }

  // Parse tools
  if (options.tools && options.tools.length > 0) {
    result.tools = options.tools.filter(isFunctionTool).map(parseTool)
  }

  return result
}

/**
 * Transform a UnifiedRequest into AI SDK LanguageModelV3CallOptions format.
 *
 * @param request - The UnifiedRequest to transform
 * @returns The AI SDK call options (without prompt, as a partial object)
 */
export function transform(request: UnifiedRequest): LanguageModelV3CallOptions {
  const prompt: LanguageModelV3Prompt = []

  // Add system message if present
  if (request.system) {
    prompt.push({
      role: 'system',
      content: request.system,
    })
  }

  // Transform messages
  for (const msg of request.messages) {
    prompt.push(transformMessage(msg))
  }

  const result: LanguageModelV3CallOptions = {
    prompt,
  }

  // Transform generation config
  if (request.config) {
    if (request.config.maxTokens !== undefined) {
      result.maxOutputTokens = request.config.maxTokens
    }
    if (request.config.temperature !== undefined) {
      result.temperature = request.config.temperature
    }
    if (request.config.topP !== undefined) {
      result.topP = request.config.topP
    }
    if (request.config.topK !== undefined) {
      result.topK = request.config.topK
    }
    if (request.config.stopSequences && request.config.stopSequences.length > 0) {
      result.stopSequences = request.config.stopSequences
    }
  }

  // Transform tools
  if (request.tools && request.tools.length > 0) {
    result.tools = request.tools.map(transformTool)
  }

  return result
}

// =============================================================================
// Message Parsing (AI SDK → Unified)
// =============================================================================

function parseMessage(msg: LanguageModelV3Message): UnifiedMessage {
  switch (msg.role) {
    case 'user':
      return parseUserMessage(msg)
    case 'assistant':
      return parseAssistantMessage(msg)
    case 'tool':
      return parseToolMessage(msg)
    case 'system':
      throw new Error('System messages should be handled separately')
    default:
      throw new Error(`Unknown message role: ${(msg as { role: string }).role}`)
  }
}

function parseUserMessage(msg: LanguageModelV3Message & { role: 'user' }): UnifiedMessage {
  return {
    role: 'user',
    parts: msg.content.map(parseUserContentPart),
  }
}

function parseAssistantMessage(
  msg: LanguageModelV3Message & { role: 'assistant' }
): UnifiedMessage {
  const parts: ContentPart[] = []

  for (const part of msg.content) {
    if (isTextPart(part)) {
      parts.push({ type: 'text', text: part.text })
    } else if (isFilePart(part)) {
      parts.push(parseFilePart(part))
    } else if (isReasoningPart(part)) {
      parts.push({
        type: 'thinking',
        thinking: { text: part.text },
      })
    } else if (isToolCallPart(part)) {
      parts.push({
        type: 'tool_call',
        toolCall: {
          id: part.toolCallId,
          name: part.toolName,
          arguments:
            typeof part.input === 'string'
              ? safeJsonParse(part.input)
              : (part.input as Record<string, unknown>),
        },
      })
    } else if (isToolResultPart(part)) {
      // Tool results in assistant messages (rare, but possible)
      const output = part.output
      let content: string
      if (output.type === 'text') {
        content = output.value
      } else if (output.type === 'json') {
        content = JSON.stringify(output.value)
      } else {
        content = 'denied'
      }
      parts.push({
        type: 'tool_result',
        toolResult: {
          toolCallId: part.toolCallId,
          content,
        },
      })
    }
  }

  return {
    role: 'assistant',
    parts,
  }
}

function parseToolMessage(msg: LanguageModelV3Message & { role: 'tool' }): UnifiedMessage {
  const parts: ContentPart[] = []

  for (const part of msg.content) {
    if (isToolResultPart(part)) {
      const output = part.output
      let content: string
      if (output.type === 'text') {
        content = output.value
      } else if (output.type === 'json') {
        content = JSON.stringify(output.value)
      } else {
        content = 'denied'
      }
      parts.push({
        type: 'tool_result',
        toolResult: {
          toolCallId: part.toolCallId,
          content,
        },
      })
    }
  }

  return {
    role: 'tool',
    parts,
  }
}

function parseUserContentPart(
  part: LanguageModelV3TextPart | LanguageModelV3FilePart
): ContentPart {
  if (isTextPart(part)) {
    return { type: 'text', text: part.text }
  } else if (isFilePart(part)) {
    return parseFilePart(part)
  }
  throw new Error(`Unknown user content part type: ${(part as { type: string }).type}`)
}

function parseFilePart(part: LanguageModelV3FilePart): ContentPart {
  // Handle different data formats
  const data = part.data

  if (typeof data === 'string') {
    // Could be base64 or URL string
    if (data.startsWith('http://') || data.startsWith('https://')) {
      return {
        type: 'image',
        image: {
          mimeType: part.mediaType,
          url: data,
        },
      }
    }
    // Assume base64
    return {
      type: 'image',
      image: {
        mimeType: part.mediaType,
        data: data,
      },
    }
  } else if (data instanceof URL) {
    return {
      type: 'image',
      image: {
        mimeType: part.mediaType,
        url: data.toString(),
      },
    }
  } else if (data instanceof Uint8Array) {
    // Convert Uint8Array to base64
    const base64 = uint8ArrayToBase64(data)
    return {
      type: 'image',
      image: {
        mimeType: part.mediaType,
        data: base64,
      },
    }
  }

  throw new Error('Unknown file data format')
}

// =============================================================================
// Message Transformation (Unified → AI SDK)
// =============================================================================

function transformMessage(msg: UnifiedMessage): LanguageModelV3Message {
  switch (msg.role) {
    case 'user':
      return transformUserMessage(msg)
    case 'assistant':
      return transformAssistantMessage(msg)
    case 'tool':
      return transformToolMessage(msg)
    default:
      throw new Error(`Unknown message role: ${msg.role}`)
  }
}

function transformUserMessage(msg: UnifiedMessage): LanguageModelV3Message & { role: 'user' } {
  const content: Array<LanguageModelV3TextPart | LanguageModelV3FilePart> = []

  for (const part of msg.parts) {
    if (part.type === 'text' && part.text) {
      content.push({ type: 'text', text: part.text })
    } else if (part.type === 'image' && part.image) {
      content.push(transformImagePart(part))
    }
  }

  return {
    role: 'user',
    content,
  }
}

function transformAssistantMessage(
  msg: UnifiedMessage
): LanguageModelV3Message & { role: 'assistant' } {
  const content: Array<
    | LanguageModelV3TextPart
    | LanguageModelV3FilePart
    | LanguageModelV3ReasoningPart
    | LanguageModelV3ToolCallPart
    | LanguageModelV3ToolResultPart
  > = []

  for (const part of msg.parts) {
    if (part.type === 'text' && part.text) {
      content.push({ type: 'text', text: part.text })
    } else if (part.type === 'thinking' && part.thinking) {
      content.push({ type: 'reasoning', text: part.thinking.text })
    } else if (part.type === 'tool_call' && part.toolCall) {
      content.push({
        type: 'tool-call',
        toolCallId: part.toolCall.id,
        toolName: part.toolCall.name,
        input: part.toolCall.arguments,
      })
    } else if (part.type === 'image' && part.image) {
      content.push(transformImagePart(part))
    }
  }

  return {
    role: 'assistant',
    content,
  }
}

function transformToolMessage(msg: UnifiedMessage): LanguageModelV3Message & { role: 'tool' } {
  const content: Array<LanguageModelV3ToolResultPart> = []

  for (const part of msg.parts) {
    if (part.type === 'tool_result' && part.toolResult) {
      const contentValue = part.toolResult.content
      content.push({
        type: 'tool-result',
        toolCallId: part.toolResult.toolCallId,
        toolName: '', // AI SDK requires toolName, but we may not have it
        output: {
          type: 'text',
          value: typeof contentValue === 'string' ? contentValue : JSON.stringify(contentValue),
        },
      })
    }
  }

  return {
    role: 'tool',
    content,
  }
}

function transformImagePart(part: ContentPart): LanguageModelV3FilePart {
  if (!part.image) {
    throw new Error('Image content part must have image data')
  }

  const image = part.image
  let data: string | URL

  if (image.data) {
    data = image.data
  } else if (image.url) {
    data = new URL(image.url)
  } else {
    throw new Error('Image must have either data or url')
  }

  return {
    type: 'file',
    mediaType: image.mimeType,
    data,
  }
}

// =============================================================================
// Tool Parsing/Transformation
// =============================================================================

function parseTool(tool: LanguageModelV3FunctionTool): UnifiedTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as JSONSchema,
  }
}

function transformTool(tool: UnifiedTool): LanguageModelV3FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  }
}

// =============================================================================
// Config Parsing
// =============================================================================

function parseConfig(options: LanguageModelV3CallOptions): NonNullable<UnifiedRequest['config']> {
  const config: NonNullable<UnifiedRequest['config']> = {}

  if (options.maxOutputTokens !== undefined) {
    config.maxTokens = options.maxOutputTokens
  }
  if (options.temperature !== undefined) {
    config.temperature = options.temperature
  }
  if (options.topP !== undefined) {
    config.topP = options.topP
  }
  if (options.topK !== undefined) {
    config.topK = options.topK
  }
  if (options.stopSequences !== undefined) {
    config.stopSequences = options.stopSequences
  }

  return config
}

// =============================================================================
// Utility Functions
// =============================================================================

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i] as number)
  }
  return btoa(binary)
}
