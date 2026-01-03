/**
 * Antigravity Request Transformations
 *
 * Handles bidirectional transformation between UnifiedRequest and AntigravityRequest.
 * Antigravity wraps Gemini-style requests with additional metadata.
 */

import { randomUUID } from 'node:crypto'
import { encodeAntigravityToolName } from '../../schema/reversible-tool-name'
import type {
  ContentPart,
  JSONSchema,
  JSONSchemaProperty,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedTool,
} from '../../types/unified'
import { createLogger } from '../../util/logger'
import { extractThinkingTier, hasThinkingTierSuffix } from '../../util/model-capabilities'
import type {
  GeminiContent,
  GeminiFunctionDeclaration,
  GeminiPart,
  GeminiSchema,
  GeminiSystemInstruction,
  GeminiTool,
  GeminiToolConfig,
} from '../gemini/types'
import { fixAntigravityToolPairing } from './pairing-fix'
import { cleanJSONSchemaForAntigravity } from './schema/antigravity-json-schema-clean'
import type {
  AntigravityGenerationConfig,
  AntigravityInnerRequest,
  AntigravityRequest,
  AntigravityThinkingConfig,
} from './types'
import { isAntigravityRequest } from './types'

const logger = createLogger({ service: 'antigravity-transform' })

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
 *
 * @param request - The unified request to transform
 * @param model - Model name to use (can include suffixes like -high)
 */
export function transform(request: UnifiedRequest, model: string): AntigravityRequest {
  const { messages, system, tools, toolChoice, config, thinking, metadata } = request

  logger.debug(
    {
      metadataKeys: metadata ? Object.keys(metadata) : [],
      metadataProject: metadata?.project,
    },
    'Antigravity transform input metadata'
  )

  // Extract wrapper fields from metadata
  // Project ID should be from credentials or use the default Antigravity project
  const project = (metadata?.project as string) || 'rising-fact-p41fc'

  // Use model parameter (from Provider interface) directly
  // NOTE: Model aliasing is handled at the server layer in handlers/streaming.ts
  // This provider receives the final model name to send to Antigravity

  logger.debug(
    {
      inputModel: model,
      metadataModel: metadata?.model,
    },
    'Model resolution'
  )

  const requestId = (metadata?.requestId as string) || `agent-${randomUUID()}`
  const sessionId = metadata?.sessionId as string | undefined

  // Check if it's a Claude model for thinking config
  const isClaudeModel = model.toLowerCase().includes('claude')
  const isThinkingModel = model.toLowerCase().includes('thinking')

  // Transform messages to contents
  let contents = transformMessages(messages)

  // Fix tool pairing (Orphan recovery & structure fix)
  contents = fixAntigravityToolPairing(contents)

  // Note: stripSignatures option was removed when changing to Provider interface signature
  // Signature stripping is now default to false (preserve signatures for Gemini 2.0)
  const shouldStripSignatures = false

  if (shouldStripSignatures) {
    // Cast to compatible types for signature stripping
    type ContentWithOptionalSignature = {
      role: string
      parts: Array<{ thoughtSignature?: string; thought?: boolean; [key: string]: unknown }>
    }
    const contentsForStripping = contents as ContentWithOptionalSignature[]

    // Custom stripping logic that converts thinking to text
    contentsForStripping.forEach((content) => {
      content.parts = content.parts.map((part) => {
        if (part.thought) {
          const { thought: _thought, thought_signature: _sig1, ...rest } = part
          return rest
        }
        // Remove signatures from other parts if present
        if (part.thought_signature) {
          const { thought_signature: _sig2, ...rest } = part
          return rest
        }
        return part
      })
    })

    contents = contentsForStripping as GeminiContent[]
  }

  // Transform system instruction
  const systemInstruction: GeminiSystemInstruction | undefined = system
    ? { parts: [{ text: system }] }
    : undefined

  // Transform tools and toolConfig
  let transformedTools: GeminiTool[] | undefined
  let toolConfig: GeminiToolConfig | undefined

  if (tools && tools.length > 0) {
    transformedTools = transformTools(tools)
    // For Claude models, MUST use VALIDATED mode (Antigravity requirement)
    // For Gemini models, toolConfig is not needed (optional)
    if (isClaudeModel) {
      // Define toolConfig first with all necessary properties
      // For Claude models, MUST use VALIDATED mode (Antigravity requirement)
      const functionCallingConfig: {
        mode: 'AUTO' | 'ANY' | 'NONE' | 'VALIDATED'
        allowedFunctionNames?: string[]
      } = {
        mode: 'VALIDATED',
        allowedFunctionNames: undefined,
      }

      // Allow specific tool selection for Claude
      if (
        toolChoice &&
        typeof toolChoice === 'object' &&
        'type' in toolChoice &&
        toolChoice.type === 'tool' &&
        'name' in toolChoice
      ) {
        const encodedName = encodeAntigravityToolName(toolChoice.name)
        functionCallingConfig.allowedFunctionNames = [encodedName]
      }

      toolConfig = {
        functionCallingConfig,
      }
    } else {
      toolConfig = {
        functionCallingConfig: {
          mode: 'AUTO',
        },
      }
    }
  } else if (toolChoice === 'none') {
    // Only set toolConfig for 'none' mode (disable tool calling)
    // Omit for default behavior
    toolConfig = {
      functionCallingConfig: {
        mode: 'NONE',
      },
    }
  }

  // Transform generation config
  const generationConfig = transformGenerationConfig(
    config,
    thinking,
    isClaudeModel,
    isThinkingModel,
    model
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

  const result: AntigravityRequest = {
    project,
    model: model, // Send full model name as requested
    userAgent: 'antigravity',
    requestId,
    request: innerRequest,
  }

  logger.debug(
    {
      project,
      model: result.model,
      originalModel: model,
      requestId,
      hasSystemInstruction: !!systemInstruction,
      toolCount: transformedTools?.length || 0,
      messageCount: messages.length,
      hasThinking: thinking?.enabled,
    },
    'Antigravity request final'
  )

  return result
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
        signature: part.thought_signature,
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
  // thinkingLevel is no longer supported in AntigravityThinkingConfig
  // const level = thinkingConfig.thinkingLevel

  if (includeThoughts === undefined && budget === undefined) {
    return undefined
  }

  // Map thinkingLevel to effort
  // let effort: ThinkingConfig['effort']
  // if (level) {
  //   effort = level as 'low' | 'medium' | 'high'
  // }

  return {
    enabled: includeThoughts ?? true,
    budget,
    // effort,
    includeThoughts,
  }
}

/**
 * Transform UnifiedMessages to Gemini contents
 *
 * Pattern from Go CLIProxyAPI:
 * 1. Build toolCallId -> toolName map for resolving tool responses
 * 2. Capture signatures from thinking blocks to pass to subsequent tool calls
 * 3. Filter out thinking blocks from model messages (Gemini doesn't need to preserve them)
 * 4. Always add skip_thought_signature_validator to functionCall if no valid signature
 */
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

  let latestSessionSignature: string | undefined

  return messages.map((message) => {
    // Capture signature from thinking parts to pass to subsequent tool calls
    // We maintain latestSessionSignature across messages to handle cases where
    // thinking and tool usage might be split across turns or in history

    // First pass: capture any signatures from thinking blocks
    for (const part of message.parts) {
      if (part.type === 'thinking' && part.thinking?.signature) {
        latestSessionSignature = part.thinking.signature
      }
    }

    // Second pass: transform parts
    // Do NOT filter thinking blocks - they are now managed by server's ensureThinkingSignatures()
    // The server handles:
    // - STEP 1: Stripping invalid thinking blocks from Amp history
    // - STEP 2: Injecting cached signatures before tool calls
    // Our job here is just to transform what the server provides
    const parts = message.parts.map((part) =>
      transformPart(part, toolNameMap, latestSessionSignature)
    )

    return {
      role: message.role === 'assistant' ? 'model' : 'user',
      parts,
    }
  })
}

/**
 * Transform a ContentPart to Gemini part
 */
function transformPart(
  part: ContentPart,
  toolNameMap?: Map<string, string>,
  fallbackSignature?: string
): GeminiPart {
  switch (part.type) {
    case 'thinking':
      return {
        thought: true,
        text: part.thinking?.text || '',
        thought_signature: part.thinking?.signature,
      }

    case 'tool_call': {
      // Gemini 2.0 requires thought_signature field on functionCall parts
      // Strategy: Use fallback signature from preceding thinking block, or skip sentinel
      // The server's ensureThinkingSignatures() should have injected valid signatures
      // for tool-use cases before this transform, but we keep the sentinel as safety net
      const SKIP_SENTINEL = 'skip_thought_signature_validator'
      const MIN_SIGNATURE_LENGTH = 50

      const hasValidSignature =
        fallbackSignature && fallbackSignature.length >= MIN_SIGNATURE_LENGTH
      const effectiveSignature = hasValidSignature ? fallbackSignature : SKIP_SENTINEL

      return {
        functionCall: {
          name: encodeAntigravityToolName(part.toolCall?.name ?? ''),
          args:
            typeof part.toolCall?.arguments === 'string'
              ? { value: part.toolCall?.arguments }
              : (part.toolCall?.arguments ?? {}),
          id: part.toolCall?.id,
        },
        thought_signature: effectiveSignature,
      }
    }

    case 'tool_result': {
      // Parse content back to object if it's a JSON string
      let response: Record<string, unknown>
      try {
        const parsed =
          typeof part.toolResult?.content === 'string'
            ? JSON.parse(part.toolResult?.content)
            : { result: part.toolResult?.content }

        // Upstream API requires a Struct (JSON object), ensuring it's not an Array or null
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          response = parsed as Record<string, unknown>
        } else {
          response = { result: parsed }
        }
      } catch {
        response = { result: part.toolResult?.content }
      }

      // Resolve original tool name from the map using toolCallId
      const toolCallId = part.toolResult?.toolCallId ?? ''
      const originalName = toolNameMap?.get(toolCallId) || 'tool'

      return {
        functionResponse: {
          name: encodeAntigravityToolName(originalName),
          response,
          id: part.toolResult?.toolCallId,
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
    default:
      return { text: part.text || '' }
  }
}

/**
 * Transform UnifiedTools to Gemini tools
 */
function transformTools(tools: UnifiedTool[]): GeminiTool[] {
  const functionDeclarations: GeminiFunctionDeclaration[] = tools.map((tool) => ({
    name: encodeAntigravityToolName(tool.name),
    description: tool.description,
    parameters: transformToGeminiSchema(cleanJSONSchemaForAntigravity(tool.parameters)),
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

  // Handle const -> enum conversion (Antigravity doesn't support const)
  // Note: cleanJSONSchemaForAntigravity already handles this, but we keep this for safety
  // if transformToGeminiSchemaProperty is called directly
  if (prop.enum) {
    result.enum = prop.enum as string[]
  }

  return result
}

/**
 * Transform generation config for Antigravity
 *
 * NOTE: This function does NOT infer thinking settings from model names.
 * All thinking configuration must come from the UnifiedRequest.thinking field.
 * - thinkingLevel: string ('low', 'medium', 'high') for Gemini 3
 * - thinkingBudget: number for Gemini 2.5 and Claude
 */
function transformGenerationConfig(
  config?: UnifiedRequest['config'],
  thinking?: UnifiedRequest['thinking'],
  isClaudeModel?: boolean,
  isThinkingModel?: boolean,
  fullModelName: string = ''
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
    const isGemini3 = fullModelName.includes('gemini-3')
    const hasGemini3Tier = hasThinkingTierSuffix(fullModelName)

    // Claude thinking models: always use snake_case keys
    if (isClaudeModel && isThinkingModel) {
      const thinkingConfig: AntigravityThinkingConfig = {}
      thinkingConfig.include_thoughts = thinking.includeThoughts ?? true
      if (thinking.budget) {
        thinkingConfig.thinking_budget = thinking.budget
      }
      // Claude thinking models need minimum maxOutputTokens
      result.maxOutputTokens = Math.max(result.maxOutputTokens || 0, 64000)
      result.thinkingConfig = thinkingConfig
    }
    // Gemini 3 with tier suffix: uses thinkingLevel string (low/medium/high)
    else if (isGemini3 && hasGemini3Tier) {
      const thinkingConfig: AntigravityThinkingConfig = {}
      thinkingConfig.includeThoughts = thinking.includeThoughts ?? true

      // Extract tier from model name suffix (e.g., gemini-3-pro-high -> 'high')
      const modelTier = extractThinkingTier(fullModelName)

      // Map tier/level to budget (ANTIGRAVITY_API_SPEC requires thinkingBudget)
      let budget: number
      if (thinking.budget) {
        budget = thinking.budget
      } else {
        const level = thinking.level || modelTier || 'high'
        // Map levels to budgets based on typical values
        switch (level) {
          case 'low':
            budget = 8192
            break
          case 'medium':
            budget = 16384
            break
          default:
            budget = 32768
            break
        }
      }

      thinkingConfig.thinkingBudget = budget
      result.thinkingConfig = thinkingConfig

      // Ensure maxOutputTokens > thinkingBudget as per spec
      if (budget && (result.maxOutputTokens ?? 0) <= budget) {
        result.maxOutputTokens = budget + 2048 // Add buffer
      }
    }
    // Gemini 2.5 and other models: use numeric thinkingBudget
    else if (thinking.budget) {
      const thinkingConfig: AntigravityThinkingConfig = {}
      thinkingConfig.includeThoughts = thinking.includeThoughts ?? true
      thinkingConfig.thinkingBudget = thinking.budget
      result.thinkingConfig = thinkingConfig
    }
    // Default: just enable thinking without specific config
    else if (thinking.includeThoughts !== false) {
      const thinkingConfig: AntigravityThinkingConfig = {}
      thinkingConfig.includeThoughts = thinking.includeThoughts ?? true
      result.thinkingConfig = thinkingConfig
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}
