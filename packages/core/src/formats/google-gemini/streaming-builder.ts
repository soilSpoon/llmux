import type { StreamChunk } from '../../types/unified'
import { normalizeStreamingOrder, type StreamingState } from '../../util/stream-normalizer'

/**
 * Gemini Streaming Builder
 *
 * Converts unified StreamChunks into Gemini SSE events.
 * Gemini format: data: {"candidates": [{"content": {"parts": [...]}}]}
 */
export class GeminiStreamingBuilder {
  private state = {
    phase: 'idle' as 'idle' | 'started' | 'finished' | 'flushed',
    accumulatedParts: [] as Array<Record<string, unknown>>,
    finishReason: null as string | null,
    usage: null as { inputTokens: number; outputTokens: number } | null,
    currentToolCallPart: null as Record<string, unknown> | null,
    streamingState: {
      hasThinkingStarted: false,
      hasThinkingEnded: false,
      hasTextStarted: false,
    } as StreamingState,
  }

  /**
   * Build Gemini SSE events from a unified StreamChunk
   */
  build(chunk: StreamChunk): string[] {
    if (this.state.phase === 'finished') {
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
      // Mark as started
      if (this.state.phase === 'idle') {
        this.state.phase = 'started'
      }

      // Handle finish/done chunks
      if (normalizedChunk.type === 'finish' || normalizedChunk.type === 'done') {
        this.state.finishReason =
          normalizedChunk.finishReason?.raw || normalizedChunk.finishReason?.unified || 'STOP'
        if (normalizedChunk.usage) {
          this.state.usage = normalizedChunk.usage
        }
        this.state.phase = 'finished'
        // Don't emit here - will emit in flush()
        continue
      }

      // Handle error chunks
      if (normalizedChunk.type === 'error') {
        const errorResponse = {
          error: {
            code: 500,
            message: normalizedChunk.error || 'Unknown error',
            status: 'INTERNAL',
          },
        }
        results.push(`data: ${JSON.stringify(errorResponse)}\n\n`)
        continue
      }

      // Build parts from chunk
      const part: Record<string, unknown> = {}

      if (normalizedChunk.type === 'text-delta' && normalizedChunk.delta?.text) {
        part.text = normalizedChunk.delta.text
        this.state.accumulatedParts.push(part)
        this.state.currentToolCallPart = null // Clear tool context on text
      } else if (
        normalizedChunk.type === 'thinking-delta' &&
        normalizedChunk.delta?.thinking?.text
      ) {
        part.text = normalizedChunk.delta.thinking.text
        part.thought = true
        this.state.accumulatedParts.push(part)
        this.state.currentToolCallPart = null
      } else if (normalizedChunk.type === 'tool-call-start' && normalizedChunk.toolCall) {
        // Store tool call info for later
        part.functionCall = {
          name: normalizedChunk.toolCall.name,
          args: {},
        }
        this.state.accumulatedParts.push(part)
        this.state.currentToolCallPart = part // Keep reference
      } else if (
        normalizedChunk.type === 'tool-input-delta' &&
        normalizedChunk.delta?.partialJson
      ) {
        // Merge tool input into last part OR currentToolCallPart
        // Try accumulatedParts first (if same batch)
        let targetPart = this.state.accumulatedParts.find(
          (p) => p === this.state.currentToolCallPart
        )

        // If not in current batch, use the stored reference
        if (!targetPart && this.state.currentToolCallPart) {
          targetPart = this.state.currentToolCallPart
          // Re-add to accumulated parts to re-emit (updated)
          this.state.accumulatedParts.push(targetPart)
        }

        if (targetPart?.functionCall) {
          try {
            const parsed = JSON.parse(normalizedChunk.delta.partialJson)
            const fc = targetPart.functionCall as { name: string; args: unknown }
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
        // Note: we KEEP state.currentToolCallPart so we can update it in next chunk if needed
      }
    }

    return results
  }

  /**
   * Flush any remaining state and emit final events
   */
  flush(): string[] {
    const results: string[] = []

    if (this.state.phase === 'finished') {
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
      this.state.phase = 'flushed'
    }

    return results
  }
}
