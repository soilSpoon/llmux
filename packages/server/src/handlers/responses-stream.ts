import {
  getFormat,
  getProvider,
  OpenAIResponsesStreamingBuilder,
  type ProviderName,
  type SchemaFormat,
} from '@llmux/core'

export function createResponsesStreamTransformer(model: string, initialProvider: ProviderName) {
  const builder = new OpenAIResponsesStreamingBuilder(model)
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let actualUpstreamProvider = initialProvider
  let providerDetected = false

  // Try to resolve format parser from initial provider immediately if possible
  const initialSourceProvider = getProvider(initialProvider)
  let formatParser: SchemaFormat | undefined
  if (initialSourceProvider.getFormatForModel) {
    const formatId = initialSourceProvider.getFormatForModel(model)
    if (formatId) {
      formatParser = getFormat(formatId)
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        if (!providerDetected) {
          providerDetected = true
          if (trimmed.includes('"response"') && trimmed.includes('"candidates"')) {
            actualUpstreamProvider = 'antigravity'
          } else if (trimmed.includes('"choices"')) {
            actualUpstreamProvider = 'openai'
          }

          // Resolve format parser from provider
          const sourceProvider = getProvider(actualUpstreamProvider)
          let formatId = sourceProvider.getFormatForModel?.(model)

          // Fallback if provider doesn't support getFormatForModel or returns undefined
          if (!formatId) {
            if (actualUpstreamProvider === 'antigravity') {
              formatId = 'google-gemini'
            } else if (actualUpstreamProvider === 'openai') {
              formatId = 'openai-chat'
            }
          }

          if (formatId) {
            formatParser = getFormat(formatId)
          }
        }

        if (!formatParser?.parseStreamChunk) {
          continue
        }

        const unified = formatParser.parseStreamChunk(trimmed)
        if (unified) {
          const chunks = Array.isArray(unified) ? unified : [unified]
          for (const c of chunks) {
            const sseEvents = builder.build(c)
            for (const sse of sseEvents) {
              controller.enqueue(encoder.encode(sse))
            }
          }
        } else if (trimmed === 'data: [DONE]') {
          const sseEvents = builder.build({ type: 'done' })
          for (const sse of sseEvents) {
            controller.enqueue(encoder.encode(sse))
          }
        }
      }
    },
    flush(controller) {
      if (buffer.trim() && formatParser?.parseStreamChunk) {
        const unified = formatParser.parseStreamChunk(buffer.trim())
        if (unified) {
          const chunks = Array.isArray(unified) ? unified : [unified]
          for (const c of chunks) {
            const sseEvents = builder.build(c)
            for (const sse of sseEvents) {
              controller.enqueue(encoder.encode(sse))
            }
          }
        }
      }

      const finalEvents = builder.build({ type: 'done' })
      for (const sse of finalEvents) {
        controller.enqueue(encoder.encode(sse))
      }
    },
  })
}
