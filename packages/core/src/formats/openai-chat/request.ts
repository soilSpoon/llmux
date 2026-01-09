/**
 * OpenAI Chat Format - Request Transformation
 *
 * Handles bidirectional transformation between OpenAI Chat request format and UnifiedRequest.
 * This module is self-contained within the formats layer (no imports from providers/).
 */

import type {
  ContentPart,
  JSONSchema,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedTool,
  UnifiedToolChoice,
} from '../../types/unified'
import { createLogger } from '../../util/logger'
import type {
  OpenAIChatAssistantMessage,
  OpenAIChatContentPart,
  OpenAIChatFlattenedToolCall,
  OpenAIChatFunctionParameters,
  OpenAIChatMessage,
  OpenAIChatRequest,
  OpenAIChatTextContent,
  OpenAIChatThinkingConfig,
  OpenAIChatTool,
  OpenAIChatToolCall,
  OpenAIChatToolChoice,
  OpenAIChatToolMessage,
  OpenAIChatUserMessage,
} from './types'

const logger = createLogger({ module: 'openai-chat-format' })

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
    : messages.filter((msg) => isOpenAIChatMessageLocal(msg))

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

  // Parse GLM thinking config
  if (request.thinking) {
    result.thinking = parseGLMThinking(request.thinking)
  }

  return result
}

/**
 * Transform a UnifiedRequest into OpenAI Chat request format.
 */
export function transformRequest(
  request: UnifiedRequest,
  model: string = 'gpt-4'
): OpenAIChatRequest {
  const result: OpenAIChatRequest = {
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
      if (request.config.responseFormat === 'json') {
        result.response_format = { type: 'json_object' }
      } else if (typeof request.config.responseFormat === 'object') {
        const format = request.config.responseFormat
        if ('type' in format && (format.type === 'text' || format.type === 'json_object')) {
          result.response_format = { type: format.type }
        }
      }
    }
  }

  // Apply thinking config (inline - no dependency on transform/thinking.ts)
  applyThinkingConfigLocal(request, model, result)

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
// Internal Helper Functions
// =============================================================================

/**
 * Check if the model is an O-series reasoning model (o1, o3, etc.)
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
 * Apply thinking config for OpenAI format (localized version, no external dependency)
 */
function applyThinkingConfigLocal(
  unified: UnifiedRequest,
  _model: string,
  targetRequest: OpenAIChatRequest
): void {
  const config = unified.thinking
  if (!config || !config.enabled) {
    return
  }

  if (config.effort) {
    targetRequest.reasoning_effort = config.effort
  }
  if (config.includeThoughts) {
    // For OpenAI, include reasoning.encrypted_content in the include array
    // This is typically set at the API call level, not in the request body
    // We leave this as a no-op since OpenAI handles it differently
  }
}

/**
 * Parse GLM thinking configuration into UnifiedRequest thinking config
 */
function parseGLMThinking(
  config: OpenAIChatThinkingConfig
): NonNullable<UnifiedRequest['thinking']> {
  const result: NonNullable<UnifiedRequest['thinking']> = {
    enabled: config.type !== 'disabled',
  }

  // clear_thinking: false means preserve context
  if (config.clear_thinking === false) {
    result.preserveContext = true
  }

  // Parse thinking budget (used by Gemini, Claude via Antigravity)
  const configAny = config as Record<string, unknown>
  if (typeof configAny.budget_tokens === 'number') {
    result.budget = configAny.budget_tokens
  }

  return result
}

/**
 * Transform UnifiedRequest thinking config into GLM thinking format
 */
function transformToGLMThinking(
  thinking: UnifiedRequest['thinking']
): OpenAIChatThinkingConfig | undefined {
  if (!thinking) {
    return undefined
  }

  const result: OpenAIChatThinkingConfig = {
    type: thinking.enabled ? 'enabled' : 'disabled',
  }

  // preserveContext: true means clear_thinking: false
  if (thinking.preserveContext === true) {
    result.clear_thinking = false
  }

  return result
}

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
function isOpenAIChatMessageLocal(obj: unknown): obj is OpenAIChatMessage {
  if (typeof obj !== 'object' || obj === null) return false
  const item = obj as Record<string, unknown>
  return typeof item.role === 'string'
}

/**
 * Reconstructs messages when tool calls are flattened into the message array.
 * Some APIs (like Responses API) flatten tool calls, so we need to regroup them.
 */
function reconstructFlattenedToolCalls(messages: unknown[]): OpenAIChatMessage[] {
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
    if (isOpenAIChatMessageLocal(msg)) {
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

function parseMessage(msg: OpenAIChatMessage): UnifiedMessage | null {
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
// Message Transformation
// =============================================================================

function transformMessage(msg: UnifiedMessage): OpenAIChatMessage {
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
  const textParts = msg.parts.filter((p) => p.type === 'text')
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
// Tool Parsing/Transformation
// =============================================================================

function parseTool(tool: OpenAIChatTool): UnifiedTool {
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

  // Handle Anthropic-style flattened tool
  const anthropicTool = tool as unknown as {
    type: 'tool'
    name: string
    description?: string
    input_schema?: JSONSchema
  }
  if (anthropicTool.name && anthropicTool.input_schema) {
    return {
      name: anthropicTool.name,
      description: anthropicTool.description,
      parameters: anthropicTool.input_schema,
    }
  }

  throw new Error(`Tool must have a function definition. Received: ${JSON.stringify(tool)}`)
}

function transformTool(tool: UnifiedTool): OpenAIChatTool {
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
      parameters: parameters as unknown as OpenAIChatFunctionParameters,
    },
  }
}

// =============================================================================
// Config Parsing
// =============================================================================

function parseConfig(request: OpenAIChatRequest): NonNullable<UnifiedRequest['config']> {
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

  if (request.logprobs !== undefined) {
    config.logprobs = request.logprobs
  }
  if (request.response_format) {
    // Basic mapping - expand if needed for strictJsonSchema
    config.responseFormat = request.response_format.type === 'json_object' ? 'json' : undefined
    if (request.response_format.type === 'json_object') {
      config.responseFormat = 'json'
    } else if (request.response_format.type !== 'text') {
      // Keep raw if it's complex schema
      config.responseFormat = request.response_format
    }
  }
  if (request.service_tier) {
    config.serviceTier = request.service_tier as 'auto' | 'flex' | 'priority'
  }
  if (request.parallel_tool_calls !== undefined) {
    config.parallelToolCalls = request.parallel_tool_calls
  }

  // Prompt Cache Key (OpenCode convention)
  if (request.user?.startsWith('cache:')) {
    // Provisional: extract cache key from user field or dedicated promptCacheKey if supported
  }

  return config
}

// =============================================================================
// Utility Functions
// =============================================================================

function extractTextContent(content: string | OpenAIChatContentPart[]): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .filter((p) => p.type === 'text' || p.type === 'input_text')
    .map((p) => (p as { type: 'text' | 'input_text'; text: string }).text)
    .join('\n')
}

function simplifyContent(content: OpenAIChatContentPart[]): string | OpenAIChatContentPart[] {
  // If only one text part, return as string
  const firstPart = content[0]
  if (content.length === 1 && firstPart && firstPart.type === 'text') {
    return (firstPart as OpenAIChatTextContent).text
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
function transformToolChoice(toolChoice?: UnifiedToolChoice): OpenAIChatToolChoice | undefined {
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
