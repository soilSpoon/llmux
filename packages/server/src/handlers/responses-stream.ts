import {
  type ProviderName,
  parseSSELine,
  type ResponsesStreamEvent,
  ResponsesStreamTransformer,
} from '@llmux/core'
import { transformStreamChunk } from './stream-processor'

function formatSSEEvent(event: ResponsesStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function createResponsesStreamTransformer(model: string, initialProvider: ProviderName) {
  const transformer = new ResponsesStreamTransformer(model)
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

        const openaiSSE = transformStreamChunk(trimmed, actualUpstreamProvider, 'openai')
        const sseLines = Array.isArray(openaiSSE) ? openaiSSE : [openaiSSE]

        for (const sseLine of sseLines) {
          const parsed = parseSSELine(sseLine)

          if (parsed === 'DONE') {
            const finalEvents = transformer.finish()
            for (const event of finalEvents) {
              controller.enqueue(encoder.encode(formatSSEEvent(event)))
            }
            continue
          }

          if (parsed !== null && typeof parsed === 'object') {
            const events = transformer.transformChunk(parsed)
            for (const event of events) {
              controller.enqueue(encoder.encode(formatSSEEvent(event)))
            }
          }
        }
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        const openaiSSE = transformStreamChunk(buffer.trim(), actualUpstreamProvider, 'openai')
        const sseLines = Array.isArray(openaiSSE) ? openaiSSE : [openaiSSE]
        for (const sseLine of sseLines) {
          const parsed = parseSSELine(sseLine)
          if (parsed !== null && parsed !== 'DONE' && typeof parsed === 'object') {
            const events = transformer.transformChunk(parsed)
            for (const event of events) {
              controller.enqueue(encoder.encode(formatSSEEvent(event)))
            }
          }
        }
      }
    },
  })
}
