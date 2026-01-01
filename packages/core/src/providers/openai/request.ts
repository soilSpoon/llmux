/**
 * OpenAI Request Transformations
 *
 * Handles bidirectional transformation between OpenAI request format and UnifiedRequest.
 */

import type {
  ContentPart,
  JSONSchema,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedTool,
  UnifiedToolChoice,
} from '../../types/unified'
import type {
  OpenAIAssistantMessage,
  OpenAIContentPart,
  OpenAIFlattenedToolCall,
  OpenAIFunctionParameters,
  OpenAIMessage,
  OpenAIRequest,
  OpenAITextContent,
  OpenAIThinkingConfig,
  OpenAITool,
  OpenAIToolCall,
  OpenAIToolChoice,
  OpenAIToolMessage,
  OpenAIUserMessage,
} from './types'

/**
 * Parse an OpenAI request into UnifiedRequest format.
 *
 * @param request - The OpenAI request to parse
 * @returns The parsed UnifiedRequest
 * @throws Error if the request is invalid
 */
export function parse(request: OpenAIRequest): UnifiedRequest {
  const result: UnifiedRequest = {
    messages: [],
  }

  let systemContent: string | undefined
  const messages = request.messages || request.input || []

  // Reconstruct messages if tool calls are flattened into the array
  // (only needed when using input field with Responses API format)
  const hasFlattenedToolCalls = messages.some(
    (msg) => msg && typeof msg === 'object' && !('role' in msg)
  )
  const reconstructedMessages: OpenAIMessage[] = hasFlattenedToolCalls
    ? reconstructFlattenedToolCalls(messages)
    : messages.filter((msg) => isOpenAIMessage(msg))

  for (const msg of reconstructedMessages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      // Extract system/developer message content
      systemContent = extractTextContent(msg.content)
    } else {
      result.messages.push(parseMessage(msg))
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

  // Parse GLM thinking config
  if (request.thinking) {
    result.thinking = parseGLMThinking(request.thinking)
  }

  return result
}

/**
 * Check if the model is an O-series reasoning model (o1, o3, etc.)
 * These models have different parameter requirements.
 */
function isReasoningModel(model: string): boolean {
  const lowerModel = model.toLowerCase()
  return (
    lowerModel.startsWith('o1') ||
    lowerModel.startsWith('o3') ||
    lowerModel.includes('-o1') ||
    lowerModel.includes('-o3') ||
    lowerModel.includes('gpt-5') // Treat gpt-5.1 as reasoning model (provisional)
  )
}

/**
 * Check if the model is a GLM model (glm-4.5, glm-4.6, glm-4.7, etc.)
 */
function isGLMModel(model: string): boolean {
  const lowerModel = model.toLowerCase()
  return lowerModel.startsWith('glm-') || lowerModel.startsWith('glm_')
}

/**
 * Parse GLM thinking configuration into UnifiedRequest thinking config
 */
function parseGLMThinking(config: OpenAIThinkingConfig): NonNullable<UnifiedRequest['thinking']> {
  const result: NonNullable<UnifiedRequest['thinking']> = {
    enabled: config.type !== 'disabled',
  }

  // clear_thinking: false means preserve context
  if (config.clear_thinking === false) {
    result.preserveContext = true
  }

  return result
}

/**
 * Transform UnifiedRequest thinking config into GLM thinking format
 */
function transformToGLMThinking(
  thinking: UnifiedRequest['thinking']
): OpenAIThinkingConfig | undefined {
  if (!thinking) {
    return undefined
  }

  const result: OpenAIThinkingConfig = {
    type: thinking.enabled ? 'enabled' : 'disabled',
  }

  // preserveContext: true means clear_thinking: false
  if (thinking.preserveContext === true) {
    result.clear_thinking = false
  }

  return result
}

/**
 * Transform a UnifiedRequest into OpenAI request format.
 *
 * @param request - The UnifiedRequest to transform
 * @param model - The model to use (defaults to 'gpt-4')
 * @returns The OpenAI request
 */
export function transform(request: UnifiedRequest, model: string = 'gpt-4'): OpenAIRequest {
  const result: OpenAIRequest = {
    model,
    messages: [],
  }

  const isReasoning = isReasoningModel(model)

  // Add system message if present
  if (request.system) {
    if (!result.messages) result.messages = []
    result.messages.push({
      role: isReasoning ? 'developer' : 'system',
      content: request.system,
    })
  }

  // Transform messages, extracting tool_result parts from user messages as separate tool messages
  for (const msg of request.messages) {
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
  }

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

// =============================================================================
// Message Reconstruction
// =============================================================================

/**
 * Type guard to check if an object is a flattened tool call
 */
function isFlattenedToolCall(obj: unknown): obj is OpenAIFlattenedToolCall {
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
 * Type guard to check if an object is an OpenAI message
 */
function isOpenAIMessage(obj: unknown): obj is OpenAIMessage {
  if (typeof obj !== 'object' || obj === null) return false
  const item = obj as Record<string, unknown>
  return typeof item.role === 'string'
}

/**
 * Reconstructs messages when tool calls are flattened into the message array.
 * Some APIs (like Responses API) flatten tool calls, so we need to regroup them.
 */
function reconstructFlattenedToolCalls(messages: unknown[]): OpenAIMessage[] {
  if (!Array.isArray(messages)) return []

  const reconstructed: OpenAIMessage[] = []
  let currentAssistantMessage: OpenAIAssistantMessage | null = null
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
        ] as OpenAIAssistantMessage
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
    if (isOpenAIMessage(msg)) {
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
// Message Parsing
// =============================================================================

function parseMessage(msg: OpenAIMessage): UnifiedMessage {
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
      const _exhaustiveCheck: never = msg
      throw new Error(`Unknown message role: ${(_exhaustiveCheck as OpenAIMessage).role}`)
    }
  }
}

function parseUserMessage(msg: OpenAIUserMessage): UnifiedMessage {
  return {
    role: 'user',
    parts: parseContent(msg.content),
  }
}

function parseAssistantMessage(msg: OpenAIAssistantMessage): UnifiedMessage {
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

function parseToolMessage(msg: OpenAIToolMessage): UnifiedMessage {
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

function parseContent(content: string | OpenAIContentPart[]): ContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }

  return content.map(parseContentPart)
}

function parseContentPart(part: OpenAIContentPart): ContentPart {
  switch (part.type) {
    case 'text':
    case 'input_text':
      return { type: 'text', text: part.text }
    case 'image_url':
      return parseImageContent(part)
    default: {
      const _exhaustiveCheck: never = part
      throw new Error(`Unknown content part type: ${(_exhaustiveCheck as OpenAIContentPart).type}`)
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
// Message Transformation
// =============================================================================

function transformMessage(msg: UnifiedMessage): OpenAIMessage {
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

function transformUserMessage(msg: UnifiedMessage): OpenAIUserMessage {
  const content = transformContent(msg.parts)
  return {
    role: 'user',
    content: simplifyContent(content),
  }
}

function transformAssistantMessage(msg: UnifiedMessage): OpenAIAssistantMessage {
  const textParts = msg.parts.filter((p) => p.type === 'text')
  const toolCallParts = msg.parts.filter((p) => p.type === 'tool_call')

  const result: OpenAIAssistantMessage = {
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
      (part): OpenAIToolCall => ({
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

function transformToolMessage(msg: UnifiedMessage): OpenAIToolMessage {
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

function transformContent(parts: ContentPart[]): OpenAIContentPart[] {
  return parts.map(transformContentPart)
}

function transformContentPart(part: ContentPart): OpenAIContentPart {
  switch (part.type) {
    case 'text':
      if (part.text === undefined) {
        throw new Error('Text content part must have text')
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

function transformImageContent(part: ContentPart): OpenAIContentPart {
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
// Tool Parsing/Transformation
// =============================================================================

function parseTool(tool: OpenAITool): UnifiedTool {
  // Handle standard OpenAI format
  if (tool.function) {
    return {
      name: tool.function.name,
      description: tool.function.description,
      parameters: (tool.function.parameters || {
        type: 'object',
      }) as JSONSchema,
    }
  }

  // Handle flattened format (seen in Oracle/opencode-zen requests)
  // type: "function", name: "...", description: "...", parameters: {...}
  const flatTool = tool as unknown as {
    name?: string
    description?: string
    parameters?: JSONSchema
  }
  if (tool.type === 'function' && flatTool.name) {
    return {
      name: flatTool.name,
      description: flatTool.description,
      parameters: (flatTool.parameters || { type: 'object' }) as JSONSchema,
    }
  }

  throw new Error(`Tool must have a function definition. Received: ${JSON.stringify(tool)}`)
}

function transformTool(tool: UnifiedTool): OpenAITool {
  // Preserve all parameter fields to avoid information loss (e.g. detailed types, enums)
  const parameters = { ...tool.parameters }

  // OpenAI requires type to be 'object' for function parameters
  if (!parameters.type) {
    parameters.type = 'object'
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: parameters as unknown as OpenAIFunctionParameters,
    },
  }
}

// =============================================================================
// Config Parsing
// =============================================================================

function parseConfig(request: OpenAIRequest): NonNullable<UnifiedRequest['config']> {
  const config: NonNullable<UnifiedRequest['config']> = {}

  if (request.max_tokens !== undefined) {
    config.maxTokens = request.max_tokens
  }
  // O-series models use max_completion_tokens
  if (request.max_completion_tokens !== undefined) {
    config.maxTokens = request.max_completion_tokens
  }
  if (request.temperature !== undefined) {
    config.temperature = request.temperature
  }
  if (request.top_p !== undefined) {
    config.topP = request.top_p
  }
  if (request.stop !== undefined) {
    config.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop]
  }

  return config
}

// =============================================================================
// Utility Functions
// =============================================================================

function extractTextContent(content: string | OpenAIContentPart[]): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .filter((p) => p.type === 'text' || p.type === 'input_text')
    .map((p) => (p as { type: 'text' | 'input_text'; text: string }).text)
    .join('\n')
}

function simplifyContent(content: OpenAIContentPart[]): string | OpenAIContentPart[] {
  // If only one text part, return as string
  const firstPart = content[0]
  if (content.length === 1 && firstPart && firstPart.type === 'text') {
    return (firstPart as OpenAITextContent).text
  }
  return content
}

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str)
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

/**
 * Transform UnifiedToolChoice to OpenAI tool_choice format
 */
function transformToolChoice(toolChoice?: UnifiedToolChoice): OpenAIToolChoice | undefined {
  if (!toolChoice) return undefined

  if (typeof toolChoice === 'string') {
    switch (toolChoice) {
      case 'auto':
        return 'auto'
      case 'none':
        return 'none'
      case 'required':
        return 'required'
      default:
        return undefined
    }
  }

  if (toolChoice.type === 'tool' && toolChoice.name) {
    return {
      type: 'function',
      function: { name: toolChoice.name },
    }
  }

  return undefined
}
