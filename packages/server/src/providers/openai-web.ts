import { createLogger } from '@llmux/core'
import { getCodexInstructions } from '../handlers/codex'

const logger = createLogger({ service: 'provider-openai-web' })

export function transformToolsForCodex(
  tools: Array<{
    type?: string
    name?: string
    description?: string
    parameters?: unknown
    input_schema?: unknown
    function?: {
      name?: string
      description?: string
      parameters?: unknown
    }
  }>
): Array<{
  type: string
  name: string
  description?: string
  parameters?: unknown
}> {
  logger.debug({ toolsCount: tools.length }, '[tools] Starting transformToolsForCodex')

  return tools.map((tool, idx) => {
    let transformed: {
      type: string
      name: string
      description?: string
      parameters?: unknown
    }

    if (tool.function?.name) {
      transformed = {
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      }
      logger.debug(
        {
          index: idx,
          originalFormat: 'ChatCompletion',
          name: tool.function.name,
        },
        '[tools] Transformed from ChatCompletion format'
      )
      return transformed
    }

    if (tool.name && tool.input_schema) {
      transformed = {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      }
      logger.debug(
        { index: idx, originalFormat: 'Anthropic', name: tool.name },
        '[tools] Transformed from Anthropic format'
      )
      return transformed
    }

    if (tool.name) {
      transformed = {
        type: tool.type || 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }
      logger.debug(
        { index: idx, originalFormat: 'Responses API', name: tool.name },
        '[tools] Already in Responses API format'
      )
      return transformed
    }

    transformed = {
      type: tool.type || 'function',
      name: tool.name || 'unknown',
      description: tool.description,
      parameters: tool.parameters || tool.input_schema,
    }
    logger.warn(
      { index: idx, originalTool: JSON.stringify(tool).slice(0, 100) },
      '[tools] Using fallback transformation (missing name)'
    )
    return transformed
  })
}

export interface CodexBodyOptions {
  model: string
  messages: unknown
  tools?: Array<{
    type?: string
    name?: string
    description?: string
    parameters?: unknown
    input_schema?: unknown
    function?: {
      name?: string
      description?: string
      parameters?: unknown
    }
  }>
  reasoning?: unknown
  systemInstructions?: string
}

export async function buildCodexBody(options: CodexBodyOptions): Promise<Record<string, unknown>> {
  const instructions = options.systemInstructions || (await getCodexInstructions(options.model))

  const transformedTools = options.tools ? transformToolsForCodex(options.tools) : undefined

  const codexBody: Record<string, unknown> = {
    model: options.model,
    instructions,
    input: options.messages,
    store: false,
    stream: true,
  }

  if (transformedTools && transformedTools.length > 0) {
    codexBody.tools = transformedTools
  }

  if (options.reasoning) {
    codexBody.reasoning = options.reasoning
  }

  logger.info(
    {
      model: options.model,
      hasInstructions: !!instructions,
      toolsCount: transformedTools?.length ?? 0,
    },
    '[openai-web] Codex body constructed'
  )

  return codexBody
}

export { getCodexInstructions }
