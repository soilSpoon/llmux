import type { JsonObject } from '../../../types/json-schema.js'
import type { StreamChunk } from '../../../types/unified.js'
import type { GeminiResponse } from '../shared/response.js'

/**
 * Gemini Streaming Builder
 *
 * Converts unified StreamChunks into Gemini SSE events.
 */
export class GeminiStreamingBuilder {
  /**
   * Build Gemini SSE events from a unified StreamChunk
   */
  build(chunk: StreamChunk): string[] {
    const results: string[] = []

    const geminiResp: GeminiResponse = {
      candidates: [
        {
          index: 0,
          content: {
            parts: [],
            role: 'model',
          },
        },
      ],
    }

    const candidate = geminiResp.candidates?.[0]
    if (!candidate || !candidate.content || !candidate.content.parts) {
      return []
    }

    const parts = candidate.content.parts

    if ((chunk.type === 'text-delta' || chunk.type === 'content') && chunk.delta?.text) {
      parts.push({ text: chunk.delta.text })
    } else if (
      (chunk.type === 'thinking-delta' || chunk.type === 'thinking') &&
      chunk.delta?.thinking
    ) {
      parts.push({
        thought: true,
        text: chunk.delta.thinking.text,
        thoughtSignature: chunk.delta.thinking.signature,
      })
    } else if (chunk.type === 'tool-call-start' && chunk.toolCall) {
      parts.push({
        functionCall: {
          id: chunk.toolCall.id || `call_${Date.now()}`,
          name: chunk.toolCall.name || 'unknown',
          args: {}, // Empty start
        },
      })
    } else if (chunk.type === 'tool-input-delta' && chunk.delta?.partialJson) {
      // Gemini usually doesn't stream partial JSON in a way that maps perfectly
      // if we are recreating the whole object, but for deltas we just send the string
      // Actually Gemini's own streaming sends the whole 'args' object or a partial one.
      // If we are strictly building for a client that expects Gemini format:
      parts.push({
        functionCall: {
          id: chunk.toolCall?.id || 'unknown',
          name: chunk.toolCall?.name || 'unknown',
          args: { _partial: chunk.delta.partialJson },
        },
      })
    } else if (chunk.type === 'tool_call' && chunk.delta?.toolCall) {
      parts.push({
        functionCall: {
          id: chunk.delta.toolCall.id || 'unknown',
          name: chunk.delta.toolCall.name || 'unknown',
          args: (chunk.delta.toolCall.arguments as JsonObject) || {},
        },
      })
    }

    if (chunk.type === 'finish' || chunk.stopReason) {
      candidate.finishReason = chunk.finishReason?.raw || 'STOP'
      if (chunk.usage) {
        geminiResp.usageMetadata = {
          promptTokenCount: chunk.usage.inputTokens,
          candidatesTokenCount: chunk.usage.outputTokens,
          totalTokenCount: (chunk.usage.inputTokens || 0) + (chunk.usage.outputTokens || 0),
        }
      }
    }

    if (parts.length > 0 || geminiResp.usageMetadata || candidate.finishReason) {
      results.push(`data: ${JSON.stringify(geminiResp)}\n\n`)
    }

    return results
  }

  /**
   * Finalize the stream
   */
  flush(): string[] {
    return []
  }
}
