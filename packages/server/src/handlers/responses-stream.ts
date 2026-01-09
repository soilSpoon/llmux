import { getProvider, OpenAIResponsesStreamingBuilder, type ProviderName } from '@llmux/core'

export function createResponsesStreamTransformer(model: string, initialProvider: ProviderName) {
  const builder = new OpenAIResponsesStreamingBuilder(model)
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let actualUpstreamProvider = initialProvider
  let providerDetected = false

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
        }

        const sourceProvider = getProvider(actualUpstreamProvider)
        if (!sourceProvider.parseStreamChunk) {
          continue
        }

        const unified = sourceProvider.parseStreamChunk(trimmed)
        if (unified) {
          const chunks = Array.isArray(unified) ? unified : [unified]
          for (const c of chunks) {
            const sseEvents = builder.build(c)
            for (const sse of sseEvents) {
              controller.enqueue(encoder.encode(sse))
            }
          }
        } else if (trimmed === 'data: [DONE]') {
          // Manual completion if we see [DONE] (though builder handles 'done' chunk)
          // Ensure builder is flushed
          const sseEvents = builder.build({ type: 'done' })
          for (const sse of sseEvents) {
            controller.enqueue(encoder.encode(sse))
          }
        }
      }
    },
    flush(controller) {
      // If we have remaining buffer, try to parse it
      if (buffer.trim()) {
        const sourceProvider = getProvider(actualUpstreamProvider)
        const unified = sourceProvider.parseStreamChunk?.(buffer.trim())
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

      // Ensure completion event is sent if not already
      const finalEvents = builder.build({ type: 'done' })
      for (const sse of finalEvents) {
        controller.enqueue(encoder.encode(sse))
      }
    },
  })
}
