/**
 * Anthropic Request Transformations
 *
 * Handles bidirectional transformation between UnifiedRequest and AnthropicRequest
 */

import type {
  ContentPart,
  GenerationConfig,
  JSONSchemaProperty,
  SystemBlock,
  ThinkingConfig,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedTool,
  UnifiedToolChoice,
} from '../../types/unified'
import type {
  AnthropicContentBlock,
  AnthropicImageBlock,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicSystemBlock,
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicTool,
  AnthropicToolChoice,
  AnthropicToolResultBlock,
  AnthropicToolResultContent,
  AnthropicToolUseBlock,
} from './types'
import { isAnthropicRequest } from './types'

const DEFAULT_MAX_TOKENS = 4096

/**
 * Parse AnthropicRequest into UnifiedRequest
 */
export function parse(request: unknown): UnifiedRequest {
  if (!isAnthropicRequest(request)) {
    throw new Error(
      'Invalid Anthropic request: missing required fields (model, messages, max_tokens)'
    )
  }

  const anthropic = request as AnthropicRequest

  return {
    messages: parseMessages(anthropic.messages),
    system: parseSystem(anthropic.system),
    systemBlocks: parseSystemBlocks(anthropic.system),
    tools: parseTools(anthropic.tools),
    toolChoice: parseToolChoice(anthropic.tool_choice),
    config: parseConfig(anthropic),
    thinking: parseThinking(anthropic.thinking),
    stream: anthropic.stream,
    metadata: {
      ...parseMetadata(anthropic.metadata),
      model: anthropic.model,
    },
  }
}

/**
 * Transform UnifiedRequest into AnthropicRequest
 */
export function transform(request: UnifiedRequest): AnthropicRequest {
  const result: AnthropicRequest = {
    model: (request.metadata?.model as string) || '', // Restore model from metadata
    messages: transformMessages(request.messages),
    max_tokens: request.config?.maxTokens ?? DEFAULT_MAX_TOKENS,
  }

  // Add stream if present
  if (request.stream !== undefined) {
    result.stream = request.stream
  }

  // Add system prompt - prefer systemBlocks (preserves cache_control) over system string
  if (request.systemBlocks && request.systemBlocks.length > 0) {
    result.system = request.systemBlocks.map((block) => ({
      type: 'text' as const,
      text: block.text,
      cache_control: block.cacheControl
        ? { type: block.cacheControl.type as 'ephemeral' }
        : undefined,
    }))
  } else if (request.system) {
    result.system = [{ type: 'text', text: request.system }]
  }

  // Add tools if present
  if (request.tools && request.tools.length > 0) {
    result.tools = transformTools(request.tools)
  }

  // Add tool_choice if present
  const toolChoice = transformToolChoice(request.toolChoice)
  if (toolChoice) {
    result.tool_choice = toolChoice
  }

  // Add generation config
  if (request.config?.temperature !== undefined) {
    result.temperature = request.config.temperature
  }
  if (request.config?.topP !== undefined) {
    result.top_p = request.config.topP
  }
  if (request.config?.topK !== undefined) {
    result.top_k = request.config.topK
  }
  if (request.config?.stopSequences && request.config.stopSequences.length > 0) {
    result.stop_sequences = request.config.stopSequences
  }

  // Add thinking config
  if (request.thinking) {
    if (request.thinking.enabled) {
      result.thinking = {
        type: 'enabled',
        budget_tokens: request.thinking.budget ?? 8000,
      }
    } else {
      result.thinking = { type: 'disabled' }
    }
  }

  // Add metadata if present
  if (request.metadata?.userId) {
    result.metadata = { user_id: request.metadata.userId }
  }

  return result
}

// =============================================================================
// Parse Helpers
// =============================================================================

function parseMessages(messages: AnthropicMessage[]): UnifiedMessage[] {
  return messages.map((msg) => ({
    role: msg.role,
    parts: parseContent(msg.content),
  }))
}

function parseContent(content: string | AnthropicContentBlock[]): ContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }

  return content.map(parseContentBlock).filter((part): part is ContentPart => part !== null)
}

function parseContentBlock(block: AnthropicContentBlock): ContentPart | null {
  switch (block.type) {
    case 'text': {
      const textBlock = block as AnthropicTextBlock
      return {
        type: 'text',
        text: textBlock.text,
        cacheControl: textBlock.cache_control
          ? {
              type: textBlock.cache_control.type,
              ttl: (textBlock.cache_control as { type: string; ttl?: string }).ttl,
            }
          : undefined,
      }
    }

    case 'image':
      return parseImageBlock(block as AnthropicImageBlock)

    case 'tool_use':
      return {
        type: 'tool_call',
        toolCall: {
          id: (block as AnthropicToolUseBlock).id,
          name: (block as AnthropicToolUseBlock).name,
          arguments: (block as AnthropicToolUseBlock).input,
        },
      }

    case 'tool_result':
      return {
        type: 'tool_result',
        toolResult: {
          toolCallId: (block as AnthropicToolResultBlock).tool_use_id,
          content: parseToolResultContent((block as AnthropicToolResultBlock).content),
          isError: (block as AnthropicToolResultBlock).is_error,
        },
      }

    case 'thinking':
      return {
        type: 'thinking',
        thinking: {
          text: (block as AnthropicThinkingBlock).thinking,
          signature: (block as AnthropicThinkingBlock).signature,
        },
      }

    case 'redacted_thinking':
      // Skip redacted thinking blocks - they cannot be displayed
      return null

    case 'document':
      // Documents are not yet supported in unified format
      return null

    default:
      return null
  }
}

function parseImageBlock(block: AnthropicImageBlock): ContentPart {
  const source = block.source
  if (source.type === 'base64') {
    return {
      type: 'image',
      image: {
        mimeType: source.media_type,
        data: source.data,
      },
    }
  } else if (source.type === 'url') {
    return {
      type: 'image',
      image: {
        mimeType: '', // URL sources don't have explicit mime type
        url: source.url,
      },
    }
  } else {
    // file source type
    return {
      type: 'image',
      image: {
        mimeType: '',
        data: (source as { file_id: string }).file_id,
      },
    }
  }
}

function parseToolResultContent(content: string | AnthropicToolResultContent[]): string {
  if (typeof content === 'string') {
    return content
  }
  // Concatenate text blocks (filter out images)
  return content
    .filter((block): block is AnthropicTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function parseSystem(system?: string | AnthropicSystemBlock[]): string | undefined {
  if (!system) return undefined

  if (typeof system === 'string') {
    return system
  }

  // Concatenate system blocks
  return system.map((block) => block.text).join('\n')
}

function parseSystemBlocks(system?: string | AnthropicSystemBlock[]): SystemBlock[] | undefined {
  if (!system) return undefined

  if (typeof system === 'string') {
    return [{ type: 'text', text: system }]
  }

  // Preserve cache_control as cacheControl
  return system.map((block) => ({
    type: 'text' as const,
    text: block.text,
    cacheControl: block.cache_control ? { type: block.cache_control.type } : undefined,
  }))
}

function parseTools(tools?: AnthropicTool[]): UnifiedTool[] | undefined {
  if (!tools || tools.length === 0) return undefined

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: (tool.input_schema.type as 'object') || 'object',
      properties: (tool.input_schema.properties ?? {}) as Record<string, JSONSchemaProperty>,
      required: tool.input_schema.required,
    },
  }))
}

function parseConfig(anthropic: AnthropicRequest): GenerationConfig {
  return {
    maxTokens: anthropic.max_tokens,
    temperature: anthropic.temperature,
    topP: anthropic.top_p,
    topK: anthropic.top_k,
    stopSequences: anthropic.stop_sequences,
  }
}

function parseThinking(
  thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' }
): ThinkingConfig | undefined {
  if (!thinking) return undefined

  if (thinking.type === 'disabled') {
    return { enabled: false }
  }

  return {
    enabled: true,
    budget: thinking.budget_tokens,
  }
}

function parseMetadata(metadata?: { user_id?: string }): { userId?: string } | undefined {
  if (!metadata?.user_id) return undefined

  return {
    userId: metadata.user_id,
  }
}

function parseToolChoice(toolChoice?: AnthropicToolChoice): UnifiedToolChoice | undefined {
  if (!toolChoice) return undefined

  switch (toolChoice.type) {
    case 'auto':
      return 'auto'
    case 'none':
      return 'none'
    case 'any':
      return 'required'
    case 'tool':
      if (toolChoice.name) {
        return { type: 'tool', name: toolChoice.name }
      }
      return 'required'
    default:
      return undefined
  }
}

// =============================================================================
// Transform Helpers
// =============================================================================

function transformMessages(messages: UnifiedMessage[]): AnthropicMessage[] {
  return messages.map((msg) => ({
    role: msg.role === 'tool' ? 'user' : msg.role, // Anthropic uses 'user' for tool results
    content: transformParts(msg.parts),
  }))
}

function transformParts(parts: ContentPart[]): AnthropicContentBlock[] {
  return parts.map(transformPart).filter((block): block is AnthropicContentBlock => block !== null)
}

function transformPart(part: ContentPart): AnthropicContentBlock | null {
  switch (part.type) {
    case 'text':
      return {
        type: 'text',
        text: part.text || '',
        cache_control: part.cacheControl
          ? {
              type: part.cacheControl.type as 'ephemeral',
              ...(part.cacheControl.ttl && { ttl: part.cacheControl.ttl }),
            }
          : undefined,
      } as AnthropicTextBlock

    case 'image':
      return transformImagePart(part)

    case 'tool_call':
      if (!part.toolCall) return null
      return {
        type: 'tool_use',
        id: part.toolCall.id,
        name: part.toolCall.name,
        input:
          typeof part.toolCall.arguments === 'string'
            ? JSON.parse(part.toolCall.arguments || '{}')
            : part.toolCall.arguments,
      }

    case 'tool_result':
      if (!part.toolResult) return null
      return {
        type: 'tool_result',
        tool_use_id: part.toolResult.toolCallId,
        content:
          typeof part.toolResult.content === 'string'
            ? part.toolResult.content
            : JSON.stringify(part.toolResult.content),
        is_error: part.toolResult.isError,
      }

    case 'thinking':
      if (!part.thinking) return null
      return {
        type: 'thinking',
        thinking: part.thinking.text,
        signature: part.thinking.signature || '',
      }

    default:
      return null
  }
}

function transformImagePart(part: ContentPart): AnthropicImageBlock | null {
  if (!part.image) return null

  if (part.image.url) {
    return {
      type: 'image',
      source: {
        type: 'url',
        url: part.image.url,
      },
    }
  } else if (part.image.data) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: part.image.mimeType,
        data: part.image.data,
      },
    }
  }

  return null
}

function transformTools(tools: UnifiedTool[]): AnthropicTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: tool.parameters.type,
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  }))
}

function transformToolChoice(toolChoice?: UnifiedToolChoice): AnthropicToolChoice | undefined {
  if (!toolChoice) return undefined

  if (typeof toolChoice === 'string') {
    switch (toolChoice) {
      case 'auto':
        return { type: 'auto' }
      case 'none':
        return { type: 'none' }
      case 'required':
        return { type: 'any' }
      default:
        return undefined
    }
  }

  if (toolChoice.type === 'tool' && toolChoice.name) {
    return { type: 'tool', name: toolChoice.name }
  }

  return undefined
}
