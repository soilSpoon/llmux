/**
 * Antigravity Request Transformations
 *
 * Handles bidirectional transformation between UnifiedRequest and AntigravityRequest.
 * Antigravity wraps Gemini-style requests with additional metadata.
 */

import { randomUUID } from 'crypto'
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
  GeminiPart,
  GeminiSchema,
  GeminiSystemInstruction,
  GeminiTool,
  GeminiToolConfig,
} from '../gemini/types'
import type {
  AntigravityGenerationConfig,
  AntigravityInnerRequest,
  AntigravityRequest,
  AntigravityThinkingConfig,
} from './types'
import { isAntigravityRequest } from './types'

/**
 * Parse an Antigravity request into UnifiedRequest format.
 * Unwraps the Antigravity envelope and parses the inner Gemini-style request.
 */
export function parse(request: unknown): UnifiedRequest {
  if (!isAntigravityRequest(request)) {
    throw new Error('Invalid Antigravity request: missing required wrapper fields')
  }

  const { project, model, requestId, request: innerRequest } = request
  const { contents, systemInstruction, tools, generationConfig, sessionId } = innerRequest

  // Parse messages
  const messages = parseContents(contents)

  // Parse system instruction
  const system = systemInstruction
    ? systemInstruction.parts.map((p) => p.text).join('\n')
    : undefined

  // Parse tools
  const unifiedTools = tools ? parseTools(tools) : undefined

  // Parse generation config
  const config = generationConfig
    ? {
        temperature: generationConfig.temperature,
        topP: generationConfig.topP,
        topK: generationConfig.topK,
        maxTokens: generationConfig.maxOutputTokens,
        stopSequences: generationConfig.stopSequences,
      }
    : undefined

  // Parse thinking config
  const thinking = parseThinkingConfig(generationConfig?.thinkingConfig)

  // Build metadata from wrapper fields
  const metadata: Record<string, unknown> = {
    project,
    model,
    requestId,
  }

  if (sessionId) {
    metadata.sessionId = sessionId
  }

  return {
    messages,
    system,
    tools: unifiedTools,
    config,
    thinking,
    metadata,
  }
}

/**
 * Transform a UnifiedRequest into Antigravity request format.
 * Wraps the Gemini-style request in an Antigravity envelope.
 */
export function transform(request: UnifiedRequest): AntigravityRequest {
  const { messages, system, tools, config, thinking, metadata } = request

  // Extract wrapper fields from metadata
  const project = (metadata?.project as string) || 'llmux'
  const model = (metadata?.model as string) || 'gemini-2.0-flash'
  const requestId = (metadata?.requestId as string) || `agent-${randomUUID()}`
  const sessionId = metadata?.sessionId as string | undefined

  // Check if it's a Claude model for thinking config
  const isClaudeModel = model.toLowerCase().includes('claude')
  const isThinkingModel = model.toLowerCase().includes('thinking')

  // Transform messages to contents
  const contents = transformMessages(messages)

  // Transform system instruction
  const systemInstruction: GeminiSystemInstruction | undefined = system
    ? { parts: [{ text: system }] }
    : undefined

  // Transform tools and toolConfig
  let transformedTools: GeminiTool[] | undefined
  let toolConfig: GeminiToolConfig | undefined

  if (tools && tools.length > 0) {
    transformedTools = transformTools(tools)
    // Antigravity always uses VALIDATED mode
    toolConfig = {
      functionCallingConfig: {
        mode: 'VALIDATED',
      },
    }
  }

  // Transform generation config
  const generationConfig = transformGenerationConfig(
    config,
    thinking,
    isClaudeModel,
    isThinkingModel
  )

  // Build inner request
  const innerRequest: AntigravityInnerRequest = {
    contents,
  }

  if (systemInstruction) {
    innerRequest.systemInstruction = systemInstruction
  }

  if (transformedTools) {
    innerRequest.tools = transformedTools
  }

  if (toolConfig) {
    innerRequest.toolConfig = toolConfig
  }

  if (generationConfig) {
    innerRequest.generationConfig = generationConfig
  }

  if (sessionId) {
    innerRequest.sessionId = sessionId
  }

  return {
    project,
    model,
    userAgent: 'antigravity',
    requestId,
    request: innerRequest,
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse Gemini contents into UnifiedMessages
 */
function parseContents(contents: GeminiContent[]): UnifiedMessage[] {
  return contents.map((content) => ({
    role: content.role === 'model' ? 'assistant' : 'user',
    parts: content.parts.map(parsePart),
  }))
}

/**
 * Parse a Gemini part into a ContentPart
 */
function parsePart(part: GeminiPart): ContentPart {
  // Thinking block
  if (part.thought && part.text !== undefined) {
    return {
      type: 'thinking',
      thinking: {
        text: part.text,
        signature: part.thoughtSignature,
      },
    }
  }

  // Function call
  if (part.functionCall) {
    return {
      type: 'tool_call',
      toolCall: {
        id: part.functionCall.id || `${part.functionCall.name}-${randomUUID()}`,
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
        toolCallId: part.functionResponse.id || part.functionResponse.name,
        content: JSON.stringify(part.functionResponse.response),
      },
    }
  }

  // Inline data (image)
  if (part.inlineData) {
    return {
      type: 'image',
      image: {
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
      },
    }
  }

  // File data (image URL)
  if (part.fileData) {
    return {
      type: 'image',
      image: {
        mimeType: part.fileData.mimeType,
        url: part.fileData.fileUri,
      },
    }
  }

  // Default: text
  return {
    type: 'text',
    text: part.text || '',
  }
}

/**
 * Parse tools from Gemini format
 */
function parseTools(tools: GeminiTool[]): UnifiedTool[] {
  const result: UnifiedTool[] = []

  for (const tool of tools) {
    if (tool.functionDeclarations) {
      for (const decl of tool.functionDeclarations) {
        result.push({
          name: decl.name,
          description: decl.description,
          parameters: parseGeminiSchema(decl.parameters || decl.parametersJsonSchema),
        })
      }
    }
  }

  return result
}

/**
 * Parse Gemini schema to JSON Schema
 */
function parseGeminiSchema(schema?: GeminiSchema): JSONSchema {
  if (!schema) {
    return { type: 'object', properties: {} }
  }

  const typeMap: Record<string, JSONSchema['type']> = {
    STRING: 'string',
    INTEGER: 'integer',
    NUMBER: 'number',
    BOOLEAN: 'boolean',
    ARRAY: 'array',
    OBJECT: 'object',
  }

  const result: JSONSchema = {
    type: typeMap[schema.type] || 'object',
  }

  if (schema.description) {
    result.description = schema.description
  }

  if (schema.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = parseGeminiSchemaProperty(value)
    }
  }

  if (schema.required) {
    result.required = schema.required
  }

  if (schema.items) {
    result.items = parseGeminiSchemaProperty(schema.items)
  }

  if (schema.enum) {
    result.enum = schema.enum
  }

  return result
}

/**
 * Parse Gemini schema property
 */
function parseGeminiSchemaProperty(schema: GeminiSchema): JSONSchemaProperty {
  const typeMap: Record<string, JSONSchemaProperty['type']> = {
    STRING: 'string',
    INTEGER: 'integer',
    NUMBER: 'number',
    BOOLEAN: 'boolean',
    ARRAY: 'array',
    OBJECT: 'object',
  }

  const result: JSONSchemaProperty = {
    type: typeMap[schema.type] || 'string',
  }

  if (schema.description) {
    result.description = schema.description
  }

  if (schema.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = parseGeminiSchemaProperty(value)
    }
  }

  if (schema.required) {
    result.required = schema.required
  }

  if (schema.items) {
    result.items = parseGeminiSchemaProperty(schema.items)
  }

  if (schema.enum) {
    result.enum = schema.enum
  }

  return result
}

/**
 * Parse thinking config from Antigravity format
 */
function parseThinkingConfig(thinkingConfig?: AntigravityThinkingConfig) {
  if (!thinkingConfig) return undefined

  // Check for either camelCase or snake_case
  const includeThoughts = thinkingConfig.includeThoughts ?? thinkingConfig.include_thoughts
  const budget = thinkingConfig.thinkingBudget ?? thinkingConfig.thinking_budget

  if (includeThoughts === undefined && budget === undefined) {
    return undefined
  }

  return {
    enabled: includeThoughts ?? true,
    budget,
    includeThoughts,
  }
}

/**
 * Transform UnifiedMessages to Gemini contents
 */
function transformMessages(messages: UnifiedMessage[]): GeminiContent[] {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: message.parts.map(transformPart),
  }))
}

/**
 * Transform a ContentPart to Gemini part
 */
function transformPart(part: ContentPart): GeminiPart {
  switch (part.type) {
    case 'thinking':
      return {
        thought: true,
        text: part.thinking?.text || '',
        thoughtSignature: part.thinking?.signature,
      }

    case 'tool_call':
      return {
        functionCall: {
          name: part.toolCall!.name,
          args: part.toolCall!.arguments,
          id: part.toolCall!.id,
        },
      }

    case 'tool_result': {
      // Parse content back to object if it's a JSON string
      let response: Record<string, unknown>
      try {
        response =
          typeof part.toolResult!.content === 'string'
            ? JSON.parse(part.toolResult!.content)
            : { result: part.toolResult!.content }
      } catch {
        response = { result: part.toolResult!.content }
      }

      return {
        functionResponse: {
          name: 'tool', // Will be matched by ID
          response,
          id: part.toolResult!.toolCallId,
        },
      }
    }

    case 'image':
      if (part.image?.data) {
        return {
          inlineData: {
            mimeType: part.image.mimeType,
            data: part.image.data,
          },
        }
      }
      if (part.image?.url) {
        return {
          fileData: {
            mimeType: part.image.mimeType,
            fileUri: part.image.url,
          },
        }
      }
      return { text: '' }

    case 'text':
    default:
      return { text: part.text || '' }
  }
}

/**
 * Transform UnifiedTools to Gemini tools
 */
function transformTools(tools: UnifiedTool[]): GeminiTool[] {
  const functionDeclarations: GeminiFunctionDeclaration[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: transformToGeminiSchema(tool.parameters),
  }))

  return [{ functionDeclarations }]
}

/**
 * Transform JSON Schema to Gemini schema
 */
function transformToGeminiSchema(schema: JSONSchema): GeminiSchema {
  const typeMap: Record<string, GeminiSchema['type']> = {
    object: 'OBJECT',
    string: 'STRING',
    integer: 'INTEGER',
    number: 'NUMBER',
    boolean: 'BOOLEAN',
    array: 'ARRAY',
  }

  const result: GeminiSchema = {
    type: typeMap[schema.type] || 'OBJECT',
  }

  if (schema.description) {
    result.description = schema.description
  }

  if (schema.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = transformToGeminiSchemaProperty(value)
    }
  }

  if (schema.required) {
    result.required = schema.required
  }

  if (schema.items) {
    result.items = transformToGeminiSchemaProperty(schema.items)
  }

  if (schema.enum) {
    result.enum = schema.enum as string[]
  }

  return result
}

/**
 * Transform JSON Schema property to Gemini schema
 */
function transformToGeminiSchemaProperty(prop: JSONSchemaProperty): GeminiSchema {
  const typeMap: Record<string, GeminiSchema['type']> = {
    object: 'OBJECT',
    string: 'STRING',
    integer: 'INTEGER',
    number: 'NUMBER',
    boolean: 'BOOLEAN',
    array: 'ARRAY',
  }

  const result: GeminiSchema = {
    type: typeMap[prop.type || 'string'] || 'STRING',
  }

  if (prop.description) {
    result.description = prop.description
  }

  if (prop.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(prop.properties)) {
      result.properties[key] = transformToGeminiSchemaProperty(value)
    }
  }

  if (prop.required) {
    result.required = prop.required
  }

  if (prop.items) {
    result.items = transformToGeminiSchemaProperty(prop.items)
  }

  if (prop.enum) {
    result.enum = prop.enum as string[]
  }

  return result
}

/**
 * Transform generation config for Antigravity
 */
function transformGenerationConfig(
  config?: UnifiedRequest['config'],
  thinking?: UnifiedRequest['thinking'],
  isClaudeModel?: boolean,
  isThinkingModel?: boolean
): AntigravityGenerationConfig | undefined {
  if (!config && !thinking) return undefined

  const result: AntigravityGenerationConfig = {}

  if (config) {
    if (config.temperature !== undefined) result.temperature = config.temperature
    if (config.topP !== undefined) result.topP = config.topP
    if (config.topK !== undefined) result.topK = config.topK
    if (config.maxTokens !== undefined) result.maxOutputTokens = config.maxTokens
    if (config.stopSequences) result.stopSequences = config.stopSequences
  }

  if (thinking?.enabled) {
    const thinkingConfig: AntigravityThinkingConfig = {}

    // Use snake_case for Claude models, camelCase for Gemini
    if (isClaudeModel && isThinkingModel) {
      thinkingConfig.include_thoughts = thinking.includeThoughts ?? true
      if (thinking.budget) {
        thinkingConfig.thinking_budget = thinking.budget
      }
      // Claude thinking models need minimum maxOutputTokens
      result.maxOutputTokens = Math.max(result.maxOutputTokens || 0, 64000)
    } else {
      thinkingConfig.includeThoughts = thinking.includeThoughts ?? true
      if (thinking.budget) {
        thinkingConfig.thinkingBudget = thinking.budget
      }
    }

    result.thinkingConfig = thinkingConfig
  }

  return Object.keys(result).length > 0 ? result : undefined
}
