/**
 * Transform utilities for Antigravity provider
 * Helper functions for building AntigravityInnerRequest
 */

import type { GeminiRequest } from '../../formats/google-gemini/types'
import { encodeAntigravityToolName } from '../../schema/reversible-tool-name'
import { isThinkingModel as isThinkingModelCore } from '../../thinking/model-capabilities'
import type { JSONSchema, RequestMetadata, UnifiedTool } from '../../types/unified'
import { camelToSnakeKey, convertKeysDeep } from '../../utils/casing'
import type {
  AntigravityGenerationConfig,
  AntigravityInnerRequest,
  AntigravityRequestMetadata,
  AntigravitySystemInstruction,
} from './types'

/**
 * Model type detection helpers
 */
export function isClaudeModel(model: string): boolean {
  return model.toLowerCase().includes('claude')
}

export function isGemini3Model(model: string): boolean {
  return model.toLowerCase().includes('gemini-3')
}

/**
 * Determines if a model supports thinking features.
 * Delegates to the centralized model-capabilities module.
 */
export function isThinkingModel(model: string): boolean {
  return isThinkingModelCore(model, 'antigravity')
}

/**
 * This is used at the boundary before sending to Antigravity API
 */
export function convertToWireFormat(request: AntigravityInnerRequest): Record<string, unknown> {
  return convertKeysDeep(request as unknown as Record<string, unknown>, camelToSnakeKey, {
    preserveKeys: ['contents', 'parts', 'text', 'inlineData', 'data', 'mimeType'],
    preserveTree: ['parameters', 'args', 'response'],
  }) as Record<string, unknown>
}

/**
 * Injects system instruction for Claude and Gemini 3 models
 */
export function injectSystemInstruction(
  request: AntigravityInnerRequest,
  systemPrompt: string,
  model: string
): void {
  if (!isClaudeModel(model) && !isGemini3Model(model)) {
    return
  }

  if (!request.systemInstruction) {
    request.systemInstruction = {
      role: 'user',
      parts: [{ text: systemPrompt }],
    }
    return
  }

  request.systemInstruction.role = 'user'
  const parts = request.systemInstruction.parts
  const alreadyHasIt = parts.some((p) => p.text?.includes('You are Antigravity'))
  if (!alreadyHasIt) {
    parts.unshift({ text: systemPrompt })
  }
}

/**
 * Ensures toolConfig has VALIDATED mode for Claude models
 */
export function ensureToolConfig(request: AntigravityInnerRequest, model: string): void {
  if (!isClaudeModel(model)) {
    return
  }

  if (!request.toolConfig) {
    request.toolConfig = {
      functionCallingConfig: {
        mode: 'VALIDATED',
      },
    }
    return
  }

  if (!request.toolConfig.functionCallingConfig) {
    request.toolConfig.functionCallingConfig = {
      mode: 'VALIDATED',
    }
    return
  }

  request.toolConfig.functionCallingConfig.mode = 'VALIDATED'
}

/**
 * Normalizes generation config for Claude models
 * - Converts snake_case stop_sequences to camelCase stopSequences
 * - Removes thinkingConfig for non-thinking models
 */
export function normalizeGenerationConfig(request: AntigravityInnerRequest, model: string): void {
  if (!isClaudeModel(model)) {
    return
  }

  const genConfig = request.generationConfig
  if (!genConfig) {
    return
  }

  normalizeStopSequences(genConfig)

  if (!isThinkingModel(model)) {
    removeThinkingConfig(genConfig)
  }
}

/**
 * Converts snake_case stop_sequences to camelCase stopSequences
 */
function normalizeStopSequences(genConfig: AntigravityGenerationConfig): void {
  const stopSeqs = (genConfig as { stop_sequences?: unknown }).stop_sequences
  if (Array.isArray(stopSeqs) && !genConfig.stopSequences) {
    genConfig.stopSequences = stopSeqs as string[]
    delete (genConfig as { stop_sequences?: unknown }).stop_sequences
  }
}

/**
 * Removes thinkingConfig from generation config
 */
function removeThinkingConfig(genConfig: AntigravityGenerationConfig): void {
  if (genConfig.thinkingConfig) {
    delete genConfig.thinkingConfig
  }
  if ((genConfig as { thinking_config?: unknown }).thinking_config) {
    delete (genConfig as { thinking_config?: unknown }).thinking_config
  }
}

/**
 * Extracts metadata fields from UnifiedRequest metadata
 */
export function extractMetadata(
  metadata: RequestMetadata | undefined
): AntigravityRequestMetadata | undefined {
  if (!metadata) {
    return undefined
  }

  const result: AntigravityRequestMetadata = {}
  let hasFields = false

  if (metadata.duetProject) {
    result.duetProject = metadata.duetProject
    hasFields = true
  }
  if (metadata.ideType) {
    result.ideType = metadata.ideType
    hasFields = true
  }
  if (metadata.platform) {
    result.platform = metadata.platform
    hasFields = true
  }
  if (metadata.pluginType) {
    result.pluginType = metadata.pluginType
    hasFields = true
  }
  if (metadata.promptCacheKey) {
    result.promptCacheKey = metadata.promptCacheKey
    hasFields = true
  }

  return hasFields ? result : undefined
}

/**
 * Creates AntigravityInnerRequest from GeminiRequest
 */
export function createInnerRequest(
  geminiRequest: GeminiRequest,
  sessionId: string
): AntigravityInnerRequest {
  return {
    contents: geminiRequest.contents,
    systemInstruction: geminiRequest.systemInstruction as AntigravitySystemInstruction | undefined,
    tools: geminiRequest.tools,
    toolConfig: geminiRequest.toolConfig,
    generationConfig: geminiRequest.generationConfig as AntigravityGenerationConfig | undefined,
    sessionId,
  }
}

/**
 * Preprocesses tools to handle Antigravity-specific requirements
 * - Flattens custom.input_schema wrapper if present
 */
// Helper to recursively remove 'custom' fields from schema
function sanitizeSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema

  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchema)
  }

  // Create a shallow copy to safely mutate or reassign properties
  const result = { ...(schema as Record<string, unknown>) }

  // Remove logical 'custom' field if present at this level
  if ('custom' in result) {
    delete result.custom
  }

  // Recurse into properties
  if (result.properties && typeof result.properties === 'object') {
    const props = { ...(result.properties as Record<string, unknown>) }

    // Explicitly remove 'custom' property if it exists
    if ('custom' in props) {
      delete props.custom
    }

    // Only iterate if we haven't already processed
    for (const key of Object.keys(props)) {
      if (key !== 'custom') {
        props[key] = sanitizeSchema(props[key])
      }
    }
    result.properties = props
  }

  // Recurse into items
  if (result.items) {
    result.items = sanitizeSchema(result.items)
  }

  // Recurse into logical combinators
  if (Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map(sanitizeSchema)
  }
  if (Array.isArray(result.oneOf)) {
    result.oneOf = result.oneOf.map(sanitizeSchema)
  }
  if (Array.isArray(result.allOf)) {
    result.allOf = result.allOf.map(sanitizeSchema)
  }

  // Filter 'required' to only include extant properties
  if (Array.isArray(result.required)) {
    const validProps = (result.properties || {}) as Record<string, unknown>
    const required = result.required as string[]
    const filtered = required.filter((key) => key in validProps)
    if (filtered.length === 0) {
      delete result.required
    } else {
      result.required = filtered
    }
  }

  return result
}

export function preprocessTools(tools: UnifiedTool[] | undefined): UnifiedTool[] | undefined {
  if (!tools) return undefined

  return tools.map((tool) => {
    let parameters = tool.parameters

    // Check for custom.input_schema wrapper pattern
    // Structure: parameters -> properties -> custom -> properties -> input_schema
    const props = tool.parameters?.properties
    if (props && 'custom' in props) {
      const customProp = props.custom as { properties?: { input_schema?: JSONSchema } }
      if (customProp?.properties?.input_schema) {
        parameters = customProp.properties.input_schema
      }
    }

    // Sanitize parameters to remove any remaining 'custom' fields
    if (parameters) {
      parameters = sanitizeSchema(parameters) as JSONSchema
    }

    const result = {
      ...tool,
      name: encodeAntigravityToolName(tool.name),
      parameters,
    }

    // Remove 'custom' from top-level tool if present
    if ('custom' in result) {
      delete (result as Record<string, unknown>).custom
    }

    return result
  })
}
