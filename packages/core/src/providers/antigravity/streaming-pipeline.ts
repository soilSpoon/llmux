import { accumulateGeminiResponse } from '../../sse/accumulators'
import type { StreamChunk, StreamingPipeline } from '../../types/unified'
import { type AntigravityBuilderState, AntigravityStreamingBuilder } from './streaming-builder'
import { type AntigravityParserState, AntigravityStreamingParser } from './streaming-parser'

/**
 * AntigravityStreamingPipeline - Antigravity-specific streaming transformation.
 *
 * Handles:
 * 1. Parsing Antigravity SSE events (Anthropic-style or Gemini-wrapped format)
 * 2. Building Unified StreamChunks back to Antigravity format
 * 3. Filtering unnecessary events
 * 4. Flushing final state when stream ends
 */
export function createAntigravityStreamingPipeline(model: string): StreamingPipeline {
  const state: AntigravityParserState & AntigravityBuilderState = {
    messageStartGenerated: false,
    messageStartFiltered: false,
    currentBlockType: null,
    currentBlockIndex: 0,
    hasToolUseBlock: false,
    detectedFormat: null,
    finishReason: null,
    finalUsage: null,
    messageStopEmitted: false,
  }

  const parser = new AntigravityStreamingParser(state)
  const builder = new AntigravityStreamingBuilder(state, model)

  return {
    parse(chunk: string): StreamChunk | StreamChunk[] | null {
      return parser.parse(chunk)
    },

    build(chunk: StreamChunk | StreamChunk[]): string | string[] | null {
      return builder.build(chunk)
    },

    filter(output: string): boolean {
      return builder.filter(output)
    },

    flush(): string | null {
      return builder.flush()
    },

    accumulateToJson: async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> => {
      const rawAggregated = await accumulateGeminiResponse(reader)
      // Gemini SSE accumulation logic from response-factory:
      // Wrap in { response: ... } as Antigravity/Gemini expects
      return { response: rawAggregated }
    },
  }
}
