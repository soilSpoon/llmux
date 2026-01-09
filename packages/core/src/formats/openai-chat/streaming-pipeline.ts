import type { StreamChunk, StreamingPipeline } from '../../types/unified'
import { parseStreamChunk, transformStreamChunk } from './streaming'

/**
 * OpenAIChatStreamingPipeline - OpenAI Chat Completions specific streaming transformation.
 */
export function createOpenAIChatStreamingPipeline(): StreamingPipeline {
  return {
    parse(chunk: string): StreamChunk | StreamChunk[] | null {
      return parseStreamChunk(chunk)
    },

    build(chunk: StreamChunk | StreamChunk[]): string | string[] | null {
      const chunks = Array.isArray(chunk) ? chunk : [chunk]
      const results: string[] = []

      for (const c of chunks) {
        const built = transformStreamChunk(c)
        if (built) {
          // transformStreamChunk returns "data: {...}" but doesn't add double newline
          results.push(`${built}\n\n`)
        }
      }

      return results.length > 0 ? results : null
    },

    filter(_output: string): boolean {
      return true
    },

    flush(): string | null {
      return null
    },
  }
}
