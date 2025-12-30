/**
 * Gemini Request Transformations
 * Handles bidirectional conversion between UnifiedRequest and GeminiRequest
 */

import type {
  ContentPart,
  JSONSchema,
  JSONSchemaProperty,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedTool,
} from '../../types/unified'
import type {
  GeminiContent,
  GeminiFunctionDeclaration,
  GeminiGenerationConfig,
  GeminiPart,
  GeminiRequest,
  GeminiSchema,
  GeminiSystemInstruction,
  GeminiTool,
} from './types'

/**
 * Parse GeminiRequest into UnifiedRequest
 */
export function parse(request: GeminiRequest): UnifiedRequest {
  const messages = parseContents(request.contents)
  const system = parseSystemInstruction(request.systemInstruction)
  const config = parseGenerationConfig(request.generationConfig)
  const thinking = parseThinkingConfig(request.generationConfig)
  const tools = parseTools(request.tools)

  const result: UnifiedRequest = { messages }

  if (system) result.system = system
  if (config && Object.keys(config).length > 0) result.config = config
  if (thinking) result.thinking = thinking
  if (tools && tools.length > 0) result.tools = tools

  return result
}

/**
 * Transform UnifiedRequest into GeminiRequest
 */
export function transform(request: UnifiedRequest): GeminiRequest {
  const contents = transformMessages(request.messages)
  const systemInstruction = transformSystemInstruction(request.system)
  const generationConfig = transformGenerationConfig(request.config, request.thinking)
  const tools = transformTools(request.tools)

  const result: GeminiRequest = { contents }

  if (systemInstruction) result.systemInstruction = systemInstruction
  if (generationConfig && Object.keys(generationConfig).length > 0) {
    result.generationConfig = generationConfig
  }
  if (tools && tools.length > 0) result.tools = tools

  return result
}

// =============================================================================
// Parse Helpers (Gemini → Unified)
// =============================================================================

function parseContents(contents: GeminiContent[]): UnifiedMessage[] {
  return contents.map(parseContent)
}

function parseContent(content: GeminiContent): UnifiedMessage {
  const role = content.role === 'model' ? 'assistant' : 'user'
  const parts = content.parts.map(parsePart)
  return { role, parts }
}

function parsePart(part: GeminiPart): ContentPart {
  // Text content
  if (part.text !== undefined && !part.thought) {
    return { type: 'text', text: part.text }
  }

  // Thinking content
  if (part.thought && part.text !== undefined) {
    return {
      type: 'thinking',
      thinking: {
        text: part.text,
        signature: part.thoughtSignature,
      },
    }
  }

  // Image content
  if (part.inlineData) {
    return {
      type: 'image',
      image: {
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
      },
    }
  }

  // Function call
  if (part.functionCall) {
    return {
      type: 'tool_call',
      toolCall: {
        id: part.functionCall.id || generateId(),
        name: part.functionCall.name,
        arguments: part.functionCall.args,
      },
    }
  }

  // Function response
  if (part.functionResponse) {
    return {
      type: 'tool_result',
      toolResult: {
        toolCallId: part.functionResponse.name,
        content: JSON.stringify(part.functionResponse.response),
      },
    }
  }

  // Fallback for unknown part types
  return { type: 'text', text: '' }
}

function parseSystemInstruction(systemInstruction?: GeminiSystemInstruction): string | undefined {
  if (!systemInstruction?.parts?.length) return undefined
  const firstPart = systemInstruction.parts[0]
  return firstPart?.text
}

function parseGenerationConfig(config?: GeminiGenerationConfig) {
  if (!config) return undefined

  const result: UnifiedRequest['config'] = {}

  if (config.maxOutputTokens !== undefined) {
    result.maxTokens = config.maxOutputTokens
  }
  if (config.temperature !== undefined) {
    result.temperature = config.temperature
  }
  if (config.topP !== undefined) {
    result.topP = config.topP
  }
  if (config.topK !== undefined) {
    result.topK = config.topK
  }
  if (config.stopSequences !== undefined) {
    result.stopSequences = config.stopSequences
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function parseThinkingConfig(config?: GeminiGenerationConfig) {
  if (!config?.thinkingConfig) return undefined

  const thinkingConfig = config.thinkingConfig

  // Check both camelCase and snake_case variants (for Antigravity compatibility)
  const includeThoughts = thinkingConfig.includeThoughts ?? thinkingConfig.include_thoughts
  const thinkingBudget = thinkingConfig.thinkingBudget ?? thinkingConfig.thinking_budget

  if (!includeThoughts && !thinkingBudget) return undefined

  return {
    enabled: includeThoughts ?? true,
    budget: thinkingBudget,
  }
}

function parseTools(tools?: GeminiTool[]): UnifiedTool[] | undefined {
  if (!tools?.length) return undefined

  const result: UnifiedTool[] = []

  for (const tool of tools) {
    if (tool.functionDeclarations) {
      for (const fn of tool.functionDeclarations) {
        result.push({
          name: fn.name,
          description: fn.description,
          parameters: parseSchema(fn.parameters || fn.parametersJsonSchema),
        })
      }
    }
  }

  return result.length > 0 ? result : undefined
}

function parseSchema(schema?: GeminiSchema): JSONSchema {
  if (!schema) {
    return { type: 'object', properties: {} }
  }

  const result: JSONSchema = {
    type: schema.type.toLowerCase() as JSONSchema['type'],
  }

  if (schema.description) result.description = schema.description
  if (schema.required) result.required = schema.required
  if (schema.enum) result.enum = schema.enum

  if (schema.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = parseSchemaProperty(value)
    }
  }

  if (schema.items) {
    result.items = parseSchemaProperty(schema.items)
  }

  return result
}

function parseSchemaProperty(schema: GeminiSchema): JSONSchemaProperty {
  const result: JSONSchemaProperty = {
    type: schema.type.toLowerCase() as JSONSchemaProperty['type'],
  }

  if (schema.description) result.description = schema.description
  if (schema.enum) result.enum = schema.enum
  if (schema.required) result.required = schema.required

  if (schema.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = parseSchemaProperty(value)
    }
  }

  if (schema.items) {
    result.items = parseSchemaProperty(schema.items)
  }

  if (schema.anyOf) {
    result.anyOf = schema.anyOf.map(parseSchemaProperty)
  }

  return result
}

// =============================================================================
// Transform Helpers (Unified → Gemini)
// =============================================================================

function transformMessages(messages: UnifiedMessage[]): GeminiContent[] {
  // Build a map of toolCallId -> toolName from all messages in the request
  const toolNameMap = new Map<string, string>()
  for (const message of messages) {
    if (message.parts) {
      for (const part of message.parts) {
        if (part.type === 'tool_call' && part.toolCall) {
          toolNameMap.set(part.toolCall.id, part.toolCall.name)
        }
      }
    }
  }

  return messages.map((message) => transformMessage(message, toolNameMap))
}

function transformMessage(
  message: UnifiedMessage,
  toolNameMap?: Map<string, string>
): GeminiContent {
  // Map role: user stays user, assistant becomes model, tool becomes user
  const role = message.role === 'assistant' ? 'model' : 'user'
  const parts = message.parts.map((p) => transformPart(p, toolNameMap))
  return { role, parts }
}

function transformPart(part: ContentPart, toolNameMap?: Map<string, string>): GeminiPart {
  switch (part.type) {
    case 'text':
      return { text: part.text ?? '' }

    case 'image':
      if (part.image) {
        return {
          inlineData: {
            mimeType: part.image.mimeType,
            data: part.image.data ?? '',
          },
        }
      }
      break

    case 'tool_call':
      if (part.toolCall) {
        return {
          functionCall: {
            name: part.toolCall.name,
            args:
              typeof part.toolCall.arguments === 'string'
                ? { value: part.toolCall.arguments }
                : part.toolCall.arguments,
          },
        }
      }
      break

    case 'tool_result':
      if (part.toolResult) {
        // Parse content if it's a JSON string, otherwise wrap in object
        let response: Record<string, unknown>
        try {
          response =
            typeof part.toolResult.content === 'string'
              ? JSON.parse(part.toolResult.content)
              : { result: part.toolResult.content }
        } catch {
          response = { result: part.toolResult.content }
        }

        // Resolve original tool name from the map using toolCallId
        const toolName = toolNameMap?.get(part.toolResult.toolCallId) || part.toolResult.toolCallId

        return {
          functionResponse: {
            name: toolName,
            response,
          },
        }
      }
      break

    case 'thinking':
      if (part.thinking) {
        return {
          thought: true,
          text: part.thinking.text,
          thoughtSignature: part.thinking.signature,
        }
      }
      break
  }

  return { text: '' }
}

function transformSystemInstruction(system?: string): GeminiSystemInstruction | undefined {
  if (!system) return undefined
  return { parts: [{ text: system }] }
}

function transformGenerationConfig(
  config?: UnifiedRequest['config'],
  thinking?: UnifiedRequest['thinking']
): GeminiGenerationConfig | undefined {
  const result: GeminiGenerationConfig = {}

  // Transform generation config
  if (config) {
    if (config.maxTokens !== undefined) {
      result.maxOutputTokens = config.maxTokens
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature
    }
    if (config.topP !== undefined) {
      result.topP = config.topP
    }
    if (config.topK !== undefined) {
      result.topK = config.topK
    }
    if (config.stopSequences !== undefined) {
      result.stopSequences = config.stopSequences
    }
  }

  // Transform thinking config
  if (thinking?.enabled) {
    result.thinkingConfig = {
      includeThoughts: true,
    }
    if (thinking.budget !== undefined) {
      result.thinkingConfig.thinkingBudget = thinking.budget
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function transformTools(tools?: UnifiedTool[]): GeminiTool[] | undefined {
  if (!tools?.length) return undefined

  const functionDeclarations: GeminiFunctionDeclaration[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: transformSchema(tool.parameters),
  }))

  return [{ functionDeclarations }]
}

function transformSchema(schema: JSONSchema): GeminiSchema {
  const result: GeminiSchema = {
    type: schema.type.toUpperCase() as GeminiSchema['type'],
  }

  if (schema.description) result.description = schema.description
  if (schema.required) result.required = schema.required
  if (schema.enum) result.enum = schema.enum as string[]

  if (schema.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = transformSchemaProperty(value)
    }
  }

  if (schema.items) {
    result.items = transformSchemaProperty(schema.items)
  }

  return result
}

function transformSchemaProperty(prop: JSONSchemaProperty): GeminiSchema {
  const result: GeminiSchema = {
    type: (prop.type?.toUpperCase() ?? 'STRING') as GeminiSchema['type'],
  }

  if (prop.description) result.description = prop.description
  if (prop.enum) result.enum = prop.enum as string[]
  if (prop.required) result.required = prop.required

  if (prop.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(prop.properties)) {
      result.properties[key] = transformSchemaProperty(value)
    }
  }

  if (prop.items) {
    result.items = transformSchemaProperty(prop.items)
  }

  if (prop.anyOf) {
    result.anyOf = prop.anyOf.map(transformSchemaProperty)
  }

  return result
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(): string {
  return `call_${Math.random().toString(36).slice(2, 11)}`
}
