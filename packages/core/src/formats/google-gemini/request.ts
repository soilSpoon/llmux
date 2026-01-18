/**
 * Google Gemini Request Transformation
 * Handles conversion between UnifiedRequest and GeminiRequest
 */

import type {
  ContentPart,
  JSONSchema,
  JSONSchemaProperty,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedTool,
  UnifiedToolChoice,
} from '../../types/unified'
import { normalizeToolHistory } from '../../util/tool-history'
import type { FormatContext } from '../base'
import type {
  GeminiContent,
  GeminiGenerationConfig,
  GeminiPart,
  GeminiRequest,
  GeminiSchema,
  GeminiSystemInstruction,
  GeminiTool,
  GeminiToolConfig,
} from './types'

/**
 * Parse GeminiRequest into UnifiedRequest
 */
export function parseRequest(request: GeminiRequest): UnifiedRequest {
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
export function buildWireRequest(request: UnifiedRequest, ctx?: FormatContext): GeminiRequest {
  const normalizedMessages = normalizeToolHistory(request.messages)
  const contents = transformMessages(normalizedMessages, ctx)
  const systemInstruction = transformSystemInstruction(request.system)
  const generationConfig = transformGenerationConfig(request.config, request.thinking, ctx)
  const tools = transformTools(request.tools)
  const toolConfig = transformToolConfig(request.toolChoice)

  return {
    contents,
    ...(systemInstruction && { systemInstruction }),
    ...(generationConfig && { generationConfig }),
    ...(tools && { tools }),
    ...(toolConfig && { toolConfig }),
  }
}

// =============================================================================
// Parse Helpers (Gemini → Unified)
// =============================================================================

/**
 * Context for resolving functionResponse names from functionCalls
 * When functionResponse has empty name or no id, we need to match by:
 * 1. functionResponse.id -> functionCall.id (preferred)
 * 2. Position/index in the message (fallback)
 */
interface FunctionCallContext {
  // Map of id -> name for quick lookup when id is present
  idToName: Map<string, string>
  // Array of names in order for position-based matching when id is missing
  orderedNames: string[]
}

/**
 * Build function call context from all contents for resolving functionResponse names
 */
function buildFunctionCallContext(contents: GeminiContent[]): FunctionCallContext {
  const idToName = new Map<string, string>()
  const orderedNames: string[] = []

  for (const content of contents) {
    if (content.role === 'model') {
      for (const part of content.parts) {
        if (part.functionCall) {
          orderedNames.push(part.functionCall.name)
          if (part.functionCall.id) {
            idToName.set(part.functionCall.id, part.functionCall.name)
          }
        }
      }
    }
  }

  return { idToName, orderedNames }
}

function parseContents(contents: GeminiContent[]): UnifiedMessage[] {
  // First pass: build function call context
  const fcContext = buildFunctionCallContext(contents)

  // Track which index of functionResponse we're processing
  let functionResponseIndex = 0

  return contents.map((content) => parseContent(content, fcContext, () => functionResponseIndex++))
}

function parseContent(
  content: GeminiContent,
  fcContext: FunctionCallContext,
  getNextResponseIndex: () => number
): UnifiedMessage {
  const parts = content.parts.map((part) => parsePart(part, fcContext, getNextResponseIndex))

  // Determine role based on content
  let role: UnifiedMessage['role'] = content.role === 'model' ? 'assistant' : 'user'

  // If content contains tool results, force role to 'tool'
  if (parts.some((p) => p.type === 'tool_result')) {
    role = 'tool'
  }

  return { role, parts }
}

function parsePart(
  part: GeminiPart,
  fcContext: FunctionCallContext,
  getNextResponseIndex: () => number
): ContentPart {
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
    // If thoughtSignature is present, attach it to the tool_call
    const contentPart: ContentPart = {
      type: 'tool_call',
      toolCall: {
        id: part.functionCall.id || generateId(),
        name: part.functionCall.name,
        arguments: part.functionCall.args,
      },
    }

    if (part.thoughtSignature) {
      contentPart.thoughtSignature = part.thoughtSignature
      contentPart.thinking = {
        text: '', // Legacy support
        signature: part.thoughtSignature,
      }
    }

    return contentPart
  }

  // Function response
  if (part.functionResponse) {
    return parseFunctionResponsePart(part.functionResponse, fcContext, getNextResponseIndex)
  }

  // Fallback for unknown part types
  return { type: 'text', text: '' }
}

/**
 * Parses a Gemini function response part, resolving missing names if necessary.
 */
function parseFunctionResponsePart(
  functionResponse: NonNullable<GeminiPart['functionResponse']>,
  fcContext: FunctionCallContext,
  getNextResponseIndex: () => number
): ContentPart {
  const resolvedName = resolveToolName(functionResponse, fcContext, getNextResponseIndex)
  const resolvedId = functionResponse.id

  // Use resolved id if available, otherwise use the resolved name as toolCallId
  // This ensures transformPart can use toolCallId as the function name when building wire request
  const toolCallId = resolvedId || resolvedName

  // Check if response indicates an error
  const response = functionResponse.response
  const isErrorResponse = response && typeof response === 'object' && 'error' in response

  return {
    type: 'tool_result',
    toolResult: {
      toolCallId,
      content: JSON.stringify(response),
      ...(isErrorResponse && { isError: true }),
    },
  }
}

/**
 * Resolves the tool name for a function response.
 * Prioritizes existing name, then ID lookup, then positional matching.
 */
function resolveToolName(
  functionResponse: NonNullable<GeminiPart['functionResponse']>,
  fcContext: FunctionCallContext,
  getNextResponseIndex: () => number
): string {
  if (functionResponse.name) {
    return functionResponse.name
  }

  const resolvedId = functionResponse.id
  if (resolvedId && fcContext.idToName.has(resolvedId)) {
    return fcContext.idToName.get(resolvedId) ?? ''
  }

  // Fall back to position-based matching
  const responseIndex = getNextResponseIndex()
  if (responseIndex < fcContext.orderedNames.length) {
    return fcContext.orderedNames[responseIndex] ?? ''
  }

  return ''
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

  if (
    !includeThoughts &&
    !thinkingBudget &&
    !thinkingConfig.thinkingLevel &&
    !thinkingConfig.thinking_level
  )
    return undefined

  return {
    enabled: includeThoughts ?? true,
    budget: thinkingBudget,
    level: (thinkingConfig.thinkingLevel ?? thinkingConfig.thinking_level)?.toLowerCase() as
      | 'minimal'
      | 'low'
      | 'medium'
      | 'high',
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
    type: (schema.type?.toLowerCase() || 'object') as JSONSchema['type'],
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

  return result
}

function parseSchemaProperty(schema: GeminiSchema): JSONSchemaProperty {
  const result: JSONSchemaProperty = {
    type: (schema.type?.toLowerCase() || 'string') as JSONSchemaProperty['type'],
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

function transformMessages(messages: UnifiedMessage[], ctx?: FormatContext): GeminiContent[] {
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

  let latestSessionSignature: string | undefined

  return messages.map((message) => {
    // Capture signature from thinking blocks
    // This assumes chronological processing (which map does)
    if (message.parts) {
      for (const part of message.parts) {
        if (part.type === 'thinking' && part.thinking?.signature) {
          latestSessionSignature = part.thinking.signature
        }
      }
    }

    return transformMessage(message, toolNameMap, ctx, latestSessionSignature)
  })
}

function transformMessage(
  message: UnifiedMessage,
  toolNameMap?: Map<string, string>,
  ctx?: FormatContext,
  fallbackSignature?: string
): GeminiContent {
  // Map role: user stays user, assistant becomes model, tool becomes user
  const role = message.role === 'assistant' ? 'model' : 'user'

  // Transform and filter out empty text parts which cause 400 errors in Gemini API
  // This typically happens when converting Anthropic messages that have empty text blocks alongside tool use
  const parts = message.parts
    .map((p) => transformPart(p, toolNameMap, ctx, fallbackSignature))
    .filter((p) => !('text' in p && p.text === ''))

  // Using a fallback if the message ends up empty (e.g. was only empty text)
  // Gemini API requires at least one part
  if (parts.length === 0) {
    parts.push({ text: '-' })
  }

  return { role, parts }
}

function transformPart(
  part: ContentPart,
  toolNameMap?: Map<string, string>,
  _ctx?: FormatContext,
  fallbackSignature?: string
): GeminiPart {
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
            id: part.toolCall.id,
          },
          // Use local thinking signature if present (rare/merged), otherwise use fallback
          thoughtSignature:
            part.thinking?.signature || fallbackSignature || 'skip_thought_signature_validator',
          // Ensure snake_case is also populated for compatibility
          thought_signature:
            part.thinking?.signature || fallbackSignature || 'skip_thought_signature_validator',
        }
      }
      break

    case 'tool_result':
      if (part.toolResult) {
        // Parse content if it's a JSON string, otherwise wrap in object
        // IMPORTANT: Antigravity requires response to be an object, not an array
        let response: Record<string, unknown>
        try {
          const parsed =
            typeof part.toolResult.content === 'string'
              ? JSON.parse(part.toolResult.content)
              : part.toolResult.content

          // Ensure response is always an object (not array or primitive)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            response = parsed as Record<string, unknown>
          } else {
            response = { result: parsed }
          }
        } catch {
          response = { result: part.toolResult.content }
        }

        // Resolve original tool name from the map using toolCallId
        const toolName = toolNameMap?.get(part.toolResult.toolCallId) || part.toolResult.toolCallId

        const functionResponse = {
          name: toolName,
          response,
          id: part.toolResult.toolCallId,
        } as const

        // If this was an error result and the response doesn't already have error field, add it
        if (part.toolResult.isError && !('error' in response)) {
          response.error = true
        }

        return {
          functionResponse,
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

// Local extended interface for schema handling
interface ExtendedJSONSchema extends JSONSchema {
  const?: string | number | boolean
  [key: string]: unknown
}

// Local extended interface for property handling
interface ExtendedJSONSchemaProperty extends JSONSchemaProperty {
  const?: string | number | boolean
  [key: string]: unknown
}

function hasConst(
  schema: JSONSchema | JSONSchemaProperty
): schema is ExtendedJSONSchema | ExtendedJSONSchemaProperty {
  return 'const' in schema && (schema as Record<string, unknown>).const !== undefined
}

function transformGenerationConfig(
  config?: UnifiedRequest['config'],
  thinking?: UnifiedRequest['thinking'],
  ctx?: FormatContext
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
    // Detect Gemini 3+ models to use thinkingLevel instead of budget
    // Model names like: gemini-3.0-flash, gemini-3-pro, etc.
    // NOTE: -preview models (like gemini-3-pro-preview) often don't support thinkingLevel yet
    // ALSO: Antigravity Claude models (specifically those with "thinking" in name) seem to use thinkingLevel
    // or default to it, so we should treat them as Gemini 3 style to avoid "thinking_level MEDIUM not supported" errors
    const isAntigravityClaude =
      ctx?.provider === 'antigravity' &&
      ctx?.model?.toLowerCase().includes('claude') &&
      ctx?.model?.toLowerCase().includes('thinking')

    const isGemini3 =
      (ctx?.model?.includes('gemini-3') && !ctx?.model?.includes('-preview')) || isAntigravityClaude

    result.thinkingConfig = {
      includeThoughts: thinking.includeThoughts ?? true,
    }

    // Only set budget/level for internal object, transform-utils.ts will handle stripping for unsupported models
    if (isGemini3) {
      // Gemini 3 uses thinkingLevel
      // Map budget to level if level is not explicitly set
      if (!thinking.level && thinking.budget) {
        if (thinking.budget < 16384) result.thinkingConfig.thinkingLevel = 'LOW'
        else if (thinking.budget < 32768) result.thinkingConfig.thinkingLevel = 'MEDIUM'
        else result.thinkingConfig.thinkingLevel = 'HIGH'
      } else {
        result.thinkingConfig.thinkingLevel =
          (thinking.level?.toUpperCase() as 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH') || 'MEDIUM'
      }
    } else {
      // Older models use thinkingBudget
      result.thinkingConfig.thinkingBudget = thinking.budget
    }

    // Antigravity Compatibility
    // AntigravityProvider converts everything to snake_case at the boundary using convertKeysDeep
    // BUT we need to ensure the keys exist in the structure for the converter to pick them up
    // The converter will see 'thinkingConfig' and convert to 'thinking_config'
    // It will see 'thinkingBudget' and convert to 'thinking_budget'
    // It will see 'includeThoughts' and convert to 'include_thoughts'
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function transformTools(tools?: UnifiedTool[]): GeminiTool[] | undefined {
  if (!tools?.length) return undefined

  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: transformSchema(tool.parameters),
      })),
    },
  ]
}

function transformToolConfig(toolChoice?: UnifiedToolChoice): GeminiToolConfig | undefined {
  if (!toolChoice) return undefined

  let mode: 'AUTO' | 'ANY' | 'NONE' = 'AUTO'
  let allowedFunctionNames: string[] | undefined

  if (toolChoice === 'required') {
    mode = 'ANY'
  } else if (toolChoice === 'none') {
    mode = 'NONE'
  } else if (typeof toolChoice === 'object' && toolChoice.type === 'tool') {
    mode = 'ANY'
    allowedFunctionNames = [toolChoice.name]
  }

  return {
    functionCallingConfig: {
      mode,
      ...(allowedFunctionNames && { allowedFunctionNames }),
    },
  }
}

function transformSchema(schema: JSONSchema): GeminiSchema {
  // Handle 'const' by converting to enum with single value
  if (hasConst(schema)) {
    return {
      type: (schema.type?.toUpperCase() || 'STRING') as GeminiSchema['type'],
      enum: [String(schema.const)],
      ...(schema.description && { description: schema.description }),
    }
  }

  const result: GeminiSchema = {
    type: (schema.type?.toUpperCase() || 'OBJECT') as GeminiSchema['type'],
  }

  if (schema.description) result.description = schema.description
  if (schema.enum) result.enum = schema.enum.map(String)

  if (schema.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = transformSchemaProperty(value)
    }
  }

  // Filter required to only include properties that exist
  if (schema.required) {
    const props = result.properties || {}
    const filtered = schema.required.filter((key) => key in props)
    if (filtered.length > 0) {
      result.required = filtered
    }
  }

  if (schema.items) {
    result.items = transformSchemaProperty(schema.items)
  }

  return result
}

function transformSchemaProperty(prop: JSONSchemaProperty): GeminiSchema {
  // Handle 'const' by converting to enum with single value
  if (hasConst(prop)) {
    return {
      type: (prop.type?.toUpperCase() ?? 'STRING') as GeminiSchema['type'],
      enum: [String(prop.const)],
      ...(prop.description && { description: prop.description }),
    }
  }

  // Determine type:
  // 1. If explicit, use uppercased version.
  // 2. If 'anyOf' is present, default to undefined (let validation happen at nested level).
  // 3. Otherwise, default to 'STRING'.
  let type: GeminiSchema['type'] | undefined
  if (prop.type) {
    type = prop.type.toUpperCase() as GeminiSchema['type']
  } else if (!prop.anyOf) {
    // Only default to STRING if there is no structure like anyOf that provides type info
    type = 'STRING'
  }

  const result: GeminiSchema = {}
  if (type) result.type = type

  if (prop.description) result.description = prop.description
  // Convert enum values to strings as Gemini expects string enums usually
  if (prop.enum) result.enum = prop.enum.map(String)
  if (prop.properties) {
    result.properties = {}
    for (const [key, value] of Object.entries(prop.properties)) {
      result.properties[key] = transformSchemaProperty(value)
    }
  }

  if (prop.required) {
    const props = result.properties || {}
    const filtered = prop.required.filter((key) => key in props)
    if (filtered.length > 0) {
      result.required = filtered
    }
  }

  if (prop.items) {
    result.items = transformSchemaProperty(prop.items)
  }

  if (prop.anyOf) {
    const nonNullTypes = prop.anyOf.filter((s) => {
      const type = s.type?.toLowerCase()
      // Filter out type: 'null' and enum: [null]
      if (type === 'null') return false
      if (hasConst(s) && s.const === null) return false
      if (s.enum?.length === 1 && s.enum[0] === null) return false
      return true
    })

    const hasNull = prop.anyOf.length > nonNullTypes.length

    if (hasNull) {
      result.nullable = true
    }

    if (nonNullTypes.length === 1 && nonNullTypes[0]) {
      // If only one type remains, merge it
      Object.assign(result, transformSchemaProperty(nonNullTypes[0]))
    } else if (nonNullTypes.length > 1) {
      result.anyOf = nonNullTypes.map(transformSchemaProperty)
    }
    // If 0 types remain (only null), result is just { nullable: true } (and likely type: STRING default)
  }

  return result
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(): string {
  return `call_${Math.random().toString(36).slice(2, 11)}`
}
