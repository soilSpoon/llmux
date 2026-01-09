import type { StreamChunk, StreamingPipeline } from '../../types/unified'
import { parseStreamChunk } from './streaming'
import { OpenAIResponsesStreamingBuilder } from './streaming-builder'

/**
 * OpenAIResponsesStreamingPipeline - OpenAI Responses API specific streaming transformation.
 *
 * Since OpenAI Responses API is usually proxied directly or used as a base format,
 * this pipeline provides a standard parse/build path using the format-specific methods.
 */
export function createOpenAIResponsesStreamingPipeline(model?: string): StreamingPipeline {
  const builder = new OpenAIResponsesStreamingBuilder(model)

  return {
    parse(chunk: string): StreamChunk | StreamChunk[] | null {
      return parseStreamChunk(chunk)
    },

    build(chunk: StreamChunk | StreamChunk[]): string | string[] | null {
      const chunks = Array.isArray(chunk) ? chunk : [chunk]
      const results: string[] = []

      for (const c of chunks) {
        const built = builder.build(c)
        if (built && built.length > 0) {
          results.push(...built)
        }
      }

      return results.length > 0 ? results : null
    },

    filter(_output: string): boolean {
      return true
    },

    flush(): string | null {
      const flushed = builder.flush()
      return flushed.length > 0 ? flushed.join('') : null
    },
  }
}
