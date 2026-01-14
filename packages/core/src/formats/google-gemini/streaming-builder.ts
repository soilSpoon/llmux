import type { StreamChunk } from '../../types/unified'

/**
 * Gemini Streaming Builder
 *
 * Converts unified StreamChunks into Gemini SSE events.
 * Gemini format: data: {"candidates": [{"content": {"parts": [...]}}]}
 */
export class GeminiStreamingBuilder {
  private state = {
    phase: 'idle' as 'idle' | 'started' | 'finished',
    accumulatedParts: [] as Array<Record<string, unknown>>,
    finishReason: null as string | null,
    usage: null as { inputTokens: number; outputTokens: number } | null,
  }

  /**
   * Build Gemini SSE events from a unified StreamChunk
   */
  build(chunk: StreamChunk): string[] {
    if (this.state.phase === 'finished') {
      return []
    }

    const results: string[] = []

    // Mark as started
    if (this.state.phase === 'idle') {
      this.state.phase = 'started'
    }

    // Handle finish/done chunks
    if (chunk.type === 'finish' || chunk.type === 'done') {
      this.state.finishReason = chunk.finishReason?.raw || chunk.finishReason?.unified || 'STOP'
      if (chunk.usage) {
        this.state.usage = chunk.usage
      }
      this.state.phase = 'finished'
      // Don't emit here - will emit in flush()
      return results
    }

    // Handle error chunks
    if (chunk.type === 'error') {
      const errorResponse = {
        error: {
          code: 500,
          message: chunk.error || 'Unknown error',
          status: 'INTERNAL',
        },
      }
      results.push(`data: ${JSON.stringify(errorResponse)}\n\n`)
      return results
    }

    // Build parts from chunk
    const part: Record<string, unknown> = {}

    if (chunk.type === 'text-delta' && chunk.delta?.text) {
      part.text = chunk.delta.text
      this.state.accumulatedParts.push(part)
    } else if (chunk.type === 'thinking-delta' && chunk.delta?.thinking?.text) {
      part.text = chunk.delta.thinking.text
      part.thought = true
      this.state.accumulatedParts.push(part)
    } else if (chunk.type === 'tool-call-start' && chunk.toolCall) {
      // Store tool call info for later
      part.functionCall = {
        name: chunk.toolCall.name,
        args: {},
      }
      this.state.accumulatedParts.push(part)
    } else if (chunk.type === 'tool-input-delta' && chunk.delta?.partialJson) {
      // Merge tool input into last part if it's a functionCall
      const lastPart = this.state.accumulatedParts[this.state.accumulatedParts.length - 1]
      if (lastPart?.functionCall) {
        try {
          const parsed = JSON.parse(chunk.delta.partialJson)
          const fc = lastPart.functionCall as { name: string; args: unknown }
          fc.args = parsed
        } catch {
          // Keep building partial JSON
        }
      }
    }

    // Emit streaming chunk if we have accumulated parts
    if (this.state.accumulatedParts.length > 0) {
      const geminiChunk = {
        candidates: [
          {
            content: {
              parts: [...this.state.accumulatedParts],
              role: 'model',
            },
          },
        ],
      }

      results.push(`data: ${JSON.stringify(geminiChunk)}\n\n`)

      // Clear accumulated parts after emission (streaming mode)
      this.state.accumulatedParts = []
    }

    return results
  }

  /**
   * Flush any remaining state and emit final events
   */
  flush(): string[] {
    const results: string[] = []

    if (this.state.phase === 'finished') {
      // Emit final chunk with finish reason and usage
      const finalChunk: Record<string, unknown> = {
        candidates: [
          {
            content: {
              parts: this.state.accumulatedParts.length > 0 ? this.state.accumulatedParts : [],
              role: 'model',
            },
            finishReason: this.state.finishReason || 'STOP',
          },
        ],
      }

      if (this.state.usage) {
        finalChunk.usageMetadata = {
          promptTokenCount: this.state.usage.inputTokens,
          candidatesTokenCount: this.state.usage.outputTokens,
          totalTokenCount: this.state.usage.inputTokens + this.state.usage.outputTokens,
        }
      }

      results.push(`data: ${JSON.stringify(finalChunk)}\n\n`)
    }

    return results
  }
}
