import type { JsonObject } from '../../../types/json-schema.js'
import type {
  ContentPart,
  UnifiedMessage,
  UnifiedRequest,
  ThinkingConfig as UnifiedThinkingConfig,
} from '../../../types/unified.js'
import { ToolNameCodec } from '../../../util/tool-name-codec.js'
import { enforceToolPairingAdjacency } from '../../../util/tool-pairing.js'
import { isJsonObject, isRecord } from '../../../util/type-guards.js'
import { resolveGeminiFamilyCapabilities } from '../capabilities.js'
import { cleanSchemaForAntigravity } from '../shared/schema-sanitizer.js'
import { sanitizeCrossModelPayload } from '../shared/signature-sanitizer.js'
import {
  buildClaudeThinkingConfig,
  configureClaudeToolConfig,
  ensureMaxOutputTokensGreaterThanBudget,
  stripThinkingBlocksForHistory,
} from './claude.js'
import { buildAntigravityEnvelope, type EnvelopeOptions } from './envelope.js'
import { buildGeminiThinkingConfig } from './gemini.js'
import { appendClaudeThinkingHint } from './thinking-hint.js'
import {
  type AntigravityContent,
  type AntigravityGenerationConfig,
  type AntigravityPart,
  type AntigravityProviderRequest,
  type AntigravityProviderRequestPayload,
  type AntigravityTool,
  type GeminiClientContent,
  type GeminiClientRequest,
  type GeminiGenerationConfig,
  isAntigravityClientRequest,
  isAntigravityProviderRequest,
} from './types.js'

/**
 * US-011: Unified Request Builder for Antigravity
 */

const codec = new ToolNameCodec()

function normalizeAntigravitySchema(schema: unknown): JsonObject {
  if (!isJsonObject(schema)) {
    return {}
  }

  const result = { ...schema }

  // Normalize type to lowercase
  if (typeof result.type === 'string') {
    result.type = result.type.toLowerCase()
  }

  // Recurse for properties
  if (isJsonObject(result.properties)) {
    const props = result.properties
    const newProps: Record<string, JsonObject> = {}
    for (const [key, val] of Object.entries(props)) {
      newProps[key] = normalizeAntigravitySchema(val)
    }
    result.properties = newProps
  }

  // Recurse for items
  if (isJsonObject(result.items)) {
    result.items = normalizeAntigravitySchema(result.items)
  }

  return result
}

export function parseAntigravityRequest(request: unknown): UnifiedRequest {
  if (isAntigravityProviderRequest(request)) {
    return parseInternalRequest(request)
  }

  if (isAntigravityClientRequest(request)) {
    return parseClientRequest(request)
  }

  throw new Error('Invalid Antigravity request format')
}

function parseInternalRequest(request: AntigravityProviderRequest): UnifiedRequest {
  const payload = request.request

  // Parse System Instruction
  let system: string | undefined
  const sysInst = payload.system_instruction || payload.systemInstruction
  if (sysInst?.parts) {
    system = sysInst.parts.map((p) => p.text).join('\n')
  }

  const contents = payload.contents || []
  const messages = parseContents(contents)

  // Parse Config
  const genConfig = payload.generation_config || payload.generationConfig

  // Helper to get property from config allowing mixed case
  const get = <T>(k1: string, k2?: string): T | undefined => {
    if (!isRecord(genConfig)) return undefined

    if (k1 in genConfig) {
      return genConfig[k1] as T
    }

    if (k2 && k2 in genConfig) {
      return genConfig[k2] as T
    }
    return undefined
  }

  const config = genConfig
    ? {
        temperature: get<number>('temperature'),
        topP: get<number>('topP', 'top_p'),
        topK: get<number>('topK', 'top_k'),
        maxTokens: get<number>('maxOutputTokens', 'max_output_tokens'),
        stopSequences: get<string[]>('stopSequences', 'stop_sequences'),
      }
    : undefined

  // Parse Thinking
  const thinking = parseThinking(genConfig)

  // Parse Tools
  let tools: UnifiedRequest['tools']
  if (payload.tools && payload.tools.length > 0) {
    const decls = payload.tools[0]?.functionDeclarations || []
    tools = decls.map((d) => ({
      name: codec.decode(d.name),
      description: d.description,
      parameters: normalizeAntigravitySchema(d.parameters || {}),
    }))
  }

  return {
    messages,
    system,
    tools,
    config,
    thinking,
    model: request.model,
    metadata: {
      project: request.project,
      location: request.location,
      model: request.model,
      requestId: request.requestId,
      sessionId: payload.sessionId,
      userAgent: request.userAgent,
    },
  }
}

function parseClientRequest(
  request: GeminiClientRequest | import('./types.js').AntigravityClientRequest
): UnifiedRequest {
  // Handle case where request is the wrapper (AntigravityClientRequest)
  let payload: GeminiClientRequest
  let metadata: UnifiedRequest['metadata'] = {}

  if (isAntigravityClientRequest(request)) {
    const wrapper = request
    payload = wrapper.request
    metadata = {
      project: wrapper.project,
      model: wrapper.model,
      requestId: wrapper.request_id,
      sessionId: wrapper.session_id,
      userAgent: wrapper.user_agent,
    }
  } else {
    payload = request
  }

  // Parse System Instruction (snake_case)
  let system: string | undefined
  if (payload.system_instruction?.parts) {
    system = payload.system_instruction.parts.map((p) => p.text).join('\n')
  }

  // Parse Contents
  const contents = payload.contents || []
  const messages = parseContents(contents)

  // Parse Config (snake_case)
  const genConfig = payload.generation_config
  const config = genConfig
    ? {
        temperature: genConfig.temperature,
        topP: genConfig.top_p,
        topK: genConfig.top_k,
        maxTokens: genConfig.max_output_tokens,
        stopSequences: genConfig.stop_sequences,
      }
    : undefined

  // Parse Thinking (snake_case)
  const thinking = parseThinking(genConfig)

  // Parse Tools
  let tools: UnifiedRequest['tools']
  if (payload.tools && payload.tools.length > 0) {
    const decls = payload.tools[0]?.function_declarations || []
    tools = decls.map((d) => ({
      name: codec.decode(d.name),
      description: d.description,
      parameters: normalizeAntigravitySchema(d.parameters || {}),
    }))
  }

  return {
    messages,
    system,
    tools,
    config,
    thinking,
    model: metadata.model || 'unknown',
    metadata,
  }
}

function parseContents(contents: (AntigravityContent | GeminiClientContent)[]): UnifiedMessage[] {
  return contents.map((c): UnifiedMessage => {
    return {
      role: c.role === 'model' ? 'assistant' : 'user',
      parts: c.parts.map((p): ContentPart => {
        // Handle both camelCase and snake_case keys
        const text = 'text' in p ? p.text : undefined
        const thought = 'thought' in p ? p.thought : undefined
        const signature =
          'thoughtSignature' in p
            ? p.thoughtSignature
            : 'thought_signature' in p
              ? p.thought_signature
              : undefined

        // Thinking Block
        if (thought) {
          const thinkingBlock: ContentPart = {
            type: 'thinking',
            thinking: {
              text: text || '',
              signature,
            },
          }
          return thinkingBlock
        }

        // Text Block
        if (text !== undefined) return { type: 'text', text } as ContentPart

        // Inline Data (Image)
        if ('inlineData' in p && p.inlineData) {
          return {
            type: 'image',
            image: {
              mimeType: p.inlineData.mimeType,
              data: p.inlineData.data,
            },
          } as ContentPart
        }
        if ('inline_data' in p && p.inline_data) {
          return {
            type: 'image',
            image: {
              mimeType: p.inline_data.mime_type,
              data: p.inline_data.data,
            },
          } as ContentPart
        }

        // Function Call
        if ('functionCall' in p && p.functionCall) {
          return {
            type: 'tool_call',
            toolCall: {
              id: p.functionCall.id || 'unknown',
              name: codec.decode(p.functionCall.name),
              arguments: p.functionCall.args,
            },
          } as ContentPart
        }
        if ('function_call' in p && p.function_call) {
          const fc = p.function_call
          const id = fc.id || 'unknown'
          return {
            type: 'tool_call',
            toolCall: {
              id,
              name: codec.decode(fc.name),
              arguments: fc.args,
            },
          } as ContentPart
        }

        // Function Response
        if ('functionResponse' in p && p.functionResponse) {
          return parseFunctionResponse(p.functionResponse)
        }
        if ('function_response' in p && p.function_response) {
          return parseFunctionResponse(p.function_response)
        }

        return { type: 'text', text: '' }
      }),
    }
  })
}

function parseFunctionResponse(fr: {
  id?: string
  name: string
  response: { content?: JsonObject; result?: unknown } | Record<string, unknown>
}): ContentPart {
  const rawResponse = fr.response
  let contentStr: string

  if ('result' in rawResponse && rawResponse.result !== undefined) {
    contentStr =
      typeof rawResponse.result === 'string'
        ? rawResponse.result
        : JSON.stringify(rawResponse.result)
  } else if ('content' in rawResponse && rawResponse.content !== undefined) {
    contentStr = JSON.stringify(rawResponse.content)
  } else {
    // Fallback: treat the whole response object as the content
    contentStr = JSON.stringify(rawResponse)
  }

  return {
    type: 'tool_result',
    toolResult: {
      toolCallId: fr.id || '',
      content: contentStr,
    },
  } as ContentPart
}

function parseThinking(
  genConfig:
    | AntigravityGenerationConfig
    | import('./types.js').GeminiClientGenerationConfig
    | undefined
): UnifiedRequest['thinking'] {
  if (!genConfig) return undefined

  // Snake Case (Claude style)
  // Check using 'in' operator to narrow type
  if ('thinking_config' in genConfig && genConfig.thinking_config) {
    const config = genConfig.thinking_config

    // Map thinking level safely
    let level: UnifiedThinkingConfig['level']
    if (config.thinking_level) {
      const rawLevel = config.thinking_level.toLowerCase()
      if (
        rawLevel === 'minimal' ||
        rawLevel === 'low' ||
        rawLevel === 'medium' ||
        rawLevel === 'high'
      ) {
        level = rawLevel
      }
    }

    return {
      enabled: config.include_thoughts || false,
      budget: config.thinking_budget,
      includeThoughts: config.include_thoughts,
      level,
    }
  }

  // Camel Case (Gemini style)
  if ('thinkingConfig' in genConfig && genConfig.thinkingConfig) {
    const config = genConfig.thinkingConfig

    // Map thinking level safely
    let level: UnifiedThinkingConfig['level']
    if (config.thinkingLevel) {
      const rawLevel = config.thinkingLevel.toLowerCase()
      if (
        rawLevel === 'minimal' ||
        rawLevel === 'low' ||
        rawLevel === 'medium' ||
        rawLevel === 'high'
      ) {
        level = rawLevel
      }
    }

    return {
      enabled: config.includeThoughts ?? false,
      budget: config.thinkingBudget,
      level,
      includeThoughts: config.includeThoughts ?? false,
    }
  }

  return undefined
}

function parseToolResultContent(content: string | ContentPart[]): Record<string, unknown> {
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed
      }
      // For arrays or primitives, stringify them within the result wrapper
      return { result: typeof parsed === 'string' ? parsed : JSON.stringify(parsed) }
    } catch {
      return { result: content }
    }
  }
  // If it's ContentPart[], we stringify it for Gemini function response
  return { result: JSON.stringify(content) }
}

export function buildAntigravityRequest(
  req: UnifiedRequest,
  options: EnvelopeOptions
): AntigravityProviderRequest {
  const caps = resolveGeminiFamilyCapabilities(options.model)

  // 1. Message Processing (Tool Pairing & History Sanitization)
  let messages = enforceToolPairingAdjacency(req.messages, caps.requiresStrictToolPairing)

  if (caps.modelVendor === 'anthropic') {
    messages = stripThinkingBlocksForHistory(messages)
  }

  // 2. Build Contents
  // Map UnifiedMessage -> AntigravityContent
  let lastThoughtSignature: string | undefined
  const contents: AntigravityContent[] = messages.map((msg) => {
    const parts: AntigravityPart[] = []

    // For assistant messages in thinking models, if there are tool calls but no thinking block,
    // we need to inject a placeholder thinking block for Gemini compliance.
    const isThinkingModel = caps.thinkingParamStyle && caps.thinkingParamStyle !== 'none'
    const hasThinkingBlock = msg.parts.some((p) => p.type === 'thinking')
    const hasToolCall = msg.parts.some((p) => p.type === 'tool_call')

    if (msg.role === 'assistant' && isThinkingModel && hasToolCall && !hasThinkingBlock) {
      parts.push({
        thought: true,
        text: 'Thinking Process...',
        thoughtSignature: 'skip_thought_signature_validator',
      })
      lastThoughtSignature = 'skip_thought_signature_validator'
    }

    for (const p of msg.parts) {
      if (p.type === 'thinking' && p.thinking) {
        let sig = p.thinking.signature
        // Enforce minimum signature length of 30 characters for Gemini
        if (sig && sig.length < 30) {
          sig = 'skip_thought_signature_validator'
        }
        lastThoughtSignature = sig
        if (caps.modelVendor === 'google') {
          parts.push({
            thought: true,
            text: p.thinking.text ?? '',
            thoughtSignature: sig,
          })
        }
      } else if (p.type === 'text') {
        parts.push({
          text: p.text ?? '',
          thoughtSignature: lastThoughtSignature,
        })
      } else if (p.type === 'tool_call' && p.toolCall) {
        parts.push({
          functionCall: {
            id: p.toolCall.id || 'unknown_id',
            name: codec.encode(p.toolCall.name),
            args:
              typeof p.toolCall.arguments === 'string'
                ? JSON.parse(p.toolCall.arguments)
                : p.toolCall.arguments,
          },
          thoughtSignature: lastThoughtSignature || 'skip_thought_signature_validator',
        })
      } else if (p.type === 'tool_result' && p.toolResult) {
        parts.push({
          functionResponse: {
            id: p.toolResult.toolCallId,
            name: codec.encode('unknown_function'),
            response: parseToolResultContent(p.toolResult.content),
          },
          thoughtSignature: lastThoughtSignature || 'skip_thought_signature_validator',
        })
      } else if (p.type === 'image' && p.image) {
        parts.push({
          inlineData: {
            mimeType: p.image.mimeType,
            data: p.image.data || '',
          },
          thoughtSignature: lastThoughtSignature,
        })
      }
    }

    return {
      role: msg.role === 'assistant' ? 'model' : msg.role === 'tool' ? 'user' : 'user',
      parts,
    }
  })

  // Apply Cross-Model Signature Sanitization
  const sanitizedContents = sanitizeCrossModelPayload(contents, options.model)

  // 3. System Instruction
  let system_instruction: { parts: { text: string }[] } | undefined
  // Apply Interleaved Thinking Hint for Claude
  const systemWithHint = appendClaudeThinkingHint(req) || req.system

  if (systemWithHint) {
    system_instruction = { parts: [{ text: systemWithHint }] }
  }

  // 4. Tools
  let tools: AntigravityTool[] | undefined
  if (req.tools && req.tools.length > 0) {
    tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: codec.encode(t.name),
          description: t.description,
          parameters: cleanSchemaForAntigravity(t.parameters),
        })),
      },
    ]
  }

  // 5. Config (Generation & Tool)
  const common_gen_config = {
    temperature: req.config?.temperature,
    topP: req.config?.topP,
    topK: req.config?.topK,
    maxOutputTokens: req.config?.maxTokens,
    stopSequences: req.config?.stopSequences,
  }

  let tool_config: AntigravityProviderRequestPayload['tool_config']
  let generation_config: AntigravityProviderRequestPayload['generation_config']

  if (caps.modelVendor === 'anthropic') {
    tool_config = configureClaudeToolConfig() // VALIDATED mode

    const thinkingConfig =
      caps.thinkingParamStyle !== 'none' ? buildClaudeThinkingConfig(req.thinking) : undefined

    if (thinkingConfig) {
      const maxTokens = ensureMaxOutputTokensGreaterThanBudget(
        common_gen_config.maxOutputTokens,
        thinkingConfig.thinking_budget
      )
      generation_config = {
        ...common_gen_config,
        maxOutputTokens: maxTokens,
        thinking_config: thinkingConfig,
      }
    } else {
      generation_config = common_gen_config
    }
  } else if (caps.modelVendor === 'google') {
    let thinkingConfig: GeminiGenerationConfig['thinking_config']
    if (caps.thinkingParamStyle && caps.thinkingParamStyle !== 'none') {
      thinkingConfig = buildGeminiThinkingConfig(req.thinking, caps.thinkingParamStyle)
    }

    if (thinkingConfig) {
      generation_config = {
        ...common_gen_config,
        thinking_config: thinkingConfig,
      }
    } else {
      generation_config = common_gen_config
    }
  } else {
    generation_config = common_gen_config
  }

  // 6. Envelope Construction

  return buildAntigravityEnvelope(
    {
      contents: sanitizedContents,

      systemInstruction: system_instruction,

      tools,

      toolConfig: tool_config,

      generationConfig: generation_config,

      sessionId: req.metadata?.sessionId,
    },

    options
  )
}
