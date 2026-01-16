import type { StreamChunk } from '../../types/unified'
import { normalizeStreamingOrder } from '../../util/stream-normalizer'
import { transformStreamChunk } from './streaming'

/**
 * OpenAI Chat Streaming Builder
 *
 * Converts unified StreamChunks into OpenAI SSE events.
 */
export class OpenAIChatStreamingBuilder {
  private state = {
    finished: false,
    // Stream normalization state
    normalization: {
      hasThinkingStarted: false,
      hasThinkingEnded: false,
      hasTextStarted: false,
    },
  }

  /**
   * Build OpenAI SSE events from a unified StreamChunk
   */
  build(chunk: StreamChunk): string[] {
    if (this.state.finished) {
      return []
    }

    // Normalize chunks
    const normalizedChunks = normalizeStreamingOrder(chunk, this.state.normalization)
    const results: string[] = []

    for (const normalizedChunk of normalizedChunks) {
      const output = transformStreamChunk(normalizedChunk)
      if (output) {
        // In OpenAI format, each data line is followed by \n\n
        results.push(`${output}\n\n`)
      }

      if (normalizedChunk.type === 'done' || normalizedChunk.type === 'finish') {
        results.push('data: [DONE]\n\n')
        this.state.finished = true
      }
    }

    return results
  }

  /**
   * Finalize the stream
   */
  flush(): string[] {
    if (this.state.finished) {
      return []
    }

    // If we haven't sent [DONE] yet, send it now
    this.state.finished = true
    return ['data: [DONE]\n\n']
  }
}
