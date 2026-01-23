import type { JSONSchema, UnifiedTool, UnifiedToolChoice } from '../../types/unified'
import type { OpenAIChatFunctionParameters, OpenAIChatTool, OpenAIChatToolChoice } from './types'

// =============================================================================
// Tool Parsing/Transformation
// =============================================================================

export function parseTool(tool: OpenAIChatTool): UnifiedTool {
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

export function transformTool(tool: UnifiedTool): OpenAIChatTool {
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
      strict: true, // Default strict: true as per modern best practices
    },
  }
}

/**
 * Transform UnifiedToolChoice to OpenAI tool_choice format
 */
export function transformToolChoice(
  toolChoice?: UnifiedToolChoice
): OpenAIChatToolChoice | undefined {
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
