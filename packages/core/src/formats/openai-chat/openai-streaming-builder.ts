import type { StreamChunk } from '../../types/unified'
import { normalizeStreamingOrder, type StreamingState } from '../../util/stream-normalizer'
import { transformStreamChunk } from './streaming'

/**
 * OpenAI Chat Streaming Builder
 *
 * Converts unified StreamChunks into OpenAI SSE events.
 */
export class OpenAIChatStreamingBuilder {
  private state = {
    finished: false,
    hasSentRole: false,
    streamingState: {
      hasThinkingStarted: false,
      hasThinkingEnded: false,
      hasTextStarted: false,
    } as StreamingState,
  }

  /**
   * Build OpenAI SSE events from a unified StreamChunk
   */
  build(chunk: StreamChunk): string[] {
    if (this.state.finished) {
      return []
    }

    // Normalize event order first
    const { events: normalizedEvents, newState } = normalizeStreamingOrder(
      [chunk],
      this.state.streamingState
    )
    this.state.streamingState = newState

    const results: string[] = []

    for (const normalizedChunk of normalizedEvents) {
      let includeRole = false
      if (!this.state.hasSentRole) {
        // Add role to the first chunk that carries content or thinking
        if (
          normalizedChunk.type === 'content' ||
          normalizedChunk.type === 'text-delta' ||
          normalizedChunk.type === 'thinking' ||
          normalizedChunk.type === 'thinking-delta' ||
          normalizedChunk.type === 'tool_call'
        ) {
          includeRole = true
          this.state.hasSentRole = true
        }
      }

      const output = transformStreamChunk(normalizedChunk, { includeRole })
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
