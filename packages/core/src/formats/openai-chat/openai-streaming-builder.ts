import type { StreamChunk } from '../../types/unified'
import { transformStreamChunk } from './streaming'

/**
 * OpenAI Chat Streaming Builder
 *
 * Converts unified StreamChunks into OpenAI SSE events.
 */
export class OpenAIChatStreamingBuilder {
  private state = {
    finished: false,
  }

  /**
   * Build OpenAI SSE events from a unified StreamChunk
   */
  build(chunk: StreamChunk): string[] {
    if (this.state.finished) {
      return []
    }

    const output = transformStreamChunk(chunk)
    if (!output) {
      return []
    }

    // In OpenAI format, each data line is followed by \n\n
    const results = [`${output}\n\n`]

    if (chunk.type === 'done' || chunk.type === 'finish') {
      results.push('data: [DONE]\n\n')
      this.state.finished = true
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
