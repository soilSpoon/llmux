export type EffectiveProtocol = 'openai' | 'anthropic' | 'gemini'

export function resolveOpencodeZenProtocol(model: string): EffectiveProtocol | null {
  if (model.includes('claude')) {
    return 'anthropic'
  }

  if (
    model.startsWith('gpt-5') ||
    model.startsWith('glm-') ||
    model.startsWith('qwen') ||
    model.startsWith('kimi') ||
    model.startsWith('grok') ||
    model === 'big-pickle'
  ) {
    return 'openai'
  }

  if (model.startsWith('gemini')) {
    return 'gemini'
  }

  return null
}

export function getOpencodeZenEndpoint(protocol: EffectiveProtocol): string {
  switch (protocol) {
    case 'openai':
      return 'https://opencode.ai/zen/v1/chat/completions'
    case 'anthropic':
      return 'https://opencode.ai/zen/v1/messages'
    case 'gemini':
      return 'https://opencode.ai/zen/v1/generateContent'
  }
}

interface OpencodeZenTool {
  name?: string
  description?: string
  input_schema?: Record<string, unknown>
}

function stripBetaFields(body: Record<string, unknown> | unknown[]): void {
  if (!body || typeof body !== 'object') return

  if (!Array.isArray(body) && 'cache_control' in body) {
    delete body.cache_control
  }

  if (Array.isArray(body)) {
    body.forEach((item) => {
      if (typeof item === 'object' && item !== null) {
        stripBetaFields(item as Record<string, unknown>)
      }
    })
  } else {
    for (const key in body) {
      if (Object.hasOwn(body, key)) {
        const value = (body as Record<string, unknown>)[key]
        if (typeof value === 'object' && value !== null) {
          stripBetaFields(value as Record<string, unknown>)
        }
      }
    }
  }
}

export interface OpencodeZenBodyOptions {
  thinkingEnabled?: boolean
}

export function fixOpencodeZenBody(
  body: Record<string, unknown>,
  options?: OpencodeZenBodyOptions
): void {
  if (!body || typeof body !== 'object') return

  stripBetaFields(body)

  // opencode.ai/zen GLM 4.7-free supports `thinking: { type: "disabled" }` to disable thinking
  // Note: `chat_template_args` and `reasoning_effort` do NOT work - they cause errors
  const model = body.model as string | undefined
  if (model && (model.startsWith('glm-') || model.startsWith('kimi'))) {
    if (options?.thinkingEnabled === false) {
      body.thinking = { type: 'disabled' }
    }
  }

  // Remove 'reasoning_effort' parameter - not supported by opencode.ai/zen
  if ('reasoning_effort' in body) {
    delete body.reasoning_effort
  }

  const tools = body.tools as unknown[]

  if (Array.isArray(tools) && tools.length > 0) {
    const firstTool = tools[0] as OpencodeZenTool
    if (firstTool.input_schema) {
      body.tools = tools.map((t) => {
        const tool = t as OpencodeZenTool
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        }
      })
    }
  }
}
