import { accumulateGeminiResponse } from '../../sse/accumulators'
import type { StopReason, StreamChunk, StreamingPipeline } from '../../types/unified'

// SSE event format helper
const SSE_EVENT_DELIMITER = '\n\n'

function formatSSEEvent(eventType: string, data: unknown): string {
  const jsonData = typeof data === 'string' ? data : JSON.stringify(data)
  return `event: ${eventType}\ndata: ${jsonData}${SSE_EVENT_DELIMITER}`
}

/**
 * Check if a value is a valid StopReason
 */
function isStopReason(value: unknown): value is StopReason {
  const validReasons: readonly StopReason[] = [
    'end_turn',
    'max_tokens',
    'tool_use',
    'stop_sequence',
    'content_filter',
    'error',
    null,
  ]
  return validReasons.includes(value as StopReason)
}

/**
 * Map provider-specific stop reasons to unified StopReason type.
 * Handles Anthropic, Gemini, OpenAI, and other provider stop reasons.
 */
function mapToStopReason(providerReason: string | null | undefined): StopReason {
  if (!providerReason) return 'end_turn'

  if (isStopReason(providerReason)) {
    return providerReason
  }

  // Anthropic & Antigravity
  if (providerReason === 'end_turn' || providerReason === 'message_stop') {
    return 'end_turn'
  }
  if (providerReason === 'tool_use') {
    return 'tool_use'
  }
  if (providerReason === 'max_tokens') {
    return 'max_tokens'
  }
  if (providerReason === 'stop_sequence') {
    return 'stop_sequence'
  }

  // Gemini
  if (providerReason === 'FINISH_REASON_UNSPECIFIED') {
    return 'end_turn'
  }
  if (providerReason === 'STOP') {
    return 'stop_sequence'
  }
  if (providerReason === 'MAX_TOKENS') {
    return 'max_tokens'
  }
  if (providerReason === 'SAFETY' || providerReason === 'RECITATION') {
    return 'content_filter'
  }

  // Default fallback
  return 'end_turn'
}

/**
 * AntigravityStreamingPipeline - Antigravity-specific streaming transformation.
 *
 * Handles:
 * 1. Parsing Antigravity SSE events (Anthropic-style or Gemini-wrapped format)
 * 2. Building Unified StreamChunks back to Antigravity format
 * 3. Filtering unnecessary events
 * 4. Flushing final state when stream ends
 *
 * Antigravity supports hybrid streaming:
 * - Anthropic-style events: message_start, content_block_*, message_*
 * - Gemini-wrapped format: { response: { candidates: [...] } }
 */
export function createAntigravityStreamingPipeline(model: string): StreamingPipeline {
  const state = {
    messageStartGenerated: false, // Track if build() generated message_start
    messageStartFiltered: false, // Track if filter() has already passed message_start
    currentBlockType: null as 'thinking' | 'text' | 'tool_use' | null,
    currentBlockIndex: 0,
    hasToolUseBlock: false,
    detectedFormat: null as 'anthropic' | 'gemini' | null,
    finishReason: null as string | null, // Track final stop_reason
    finalUsage: null as { inputTokens: number; outputTokens: number } | null, // Track final token usage
    messageStopEmitted: false, // Track if message_stop has been emitted
  }

  return {
    parse(chunk: string): StreamChunk | StreamChunk[] | null {
      try {
        if (!chunk || chunk.trim() === 'data: [DONE]') {
          return null
        }

        const cleaned = chunk.replace(/^data:\s*/, '').trim()
        if (!cleaned) {
          return null
        }

        const parsed = JSON.parse(cleaned) as Record<string, unknown>

        // 1. Detect Anthropic-style SSE event
        if (parsed.type && typeof parsed.type === 'string') {
          state.detectedFormat = 'anthropic'

          if (parsed.type === 'message_start') {
            const message = parsed.message as Record<string, unknown>
            const usage = message?.usage as Record<string, unknown>
            return {
              type: 'usage',
              usage: {
                inputTokens: (usage?.input_tokens as number) || 0,
                outputTokens: (usage?.output_tokens as number) || 0,
              },
            }
          }

          if (parsed.type === 'content_block_start') {
            const contentBlock = parsed.content_block as Record<string, unknown>
            const blockType = contentBlock?.type as string
            const index = (parsed.index as number) || 0

            state.currentBlockType = blockType as 'thinking' | 'text' | 'tool_use'
            state.currentBlockIndex = index

            if (blockType === 'text') {
              return {
                type: 'text-delta',
                delta: { text: '' },
                blockIndex: index,
              }
            }
            if (blockType === 'thinking') {
              return {
                type: 'thinking-start',
                blockIndex: index,
              }
            }
            if (blockType === 'tool_use') {
              state.hasToolUseBlock = true
              const id = contentBlock?.id as string
              const name = contentBlock?.name as string
              return {
                type: 'tool-call-start',
                toolCall: { id, name },
                blockIndex: index,
              }
            }
            return null
          }

          if (parsed.type === 'content_block_delta') {
            const delta = parsed.delta as Record<string, unknown>
            const deltaType = delta?.type as string
            const index = (parsed.index as number) || 0

            if (deltaType === 'text_delta') {
              return {
                type: 'text-delta',
                delta: { text: (delta?.text as string) || '' },
                blockIndex: index,
              }
            }
            if (deltaType === 'thinking_delta') {
              return {
                type: 'thinking-delta',
                delta: {
                  thinking: {
                    text: (delta?.thinking as string) || '',
                  },
                },
                blockIndex: index,
              }
            }
            if (deltaType === 'input_json_delta') {
              return {
                type: 'tool-input-delta',
                delta: { partialJson: (delta?.partial_json as string) || '' },
                blockIndex: index,
              }
            }
            return null
          }

          if (parsed.type === 'content_block_stop') {
            return { type: 'block_stop' }
          }

          if (parsed.type === 'message_delta') {
            const deltaObj = parsed.delta as Record<string, unknown>
            const rawReason = (deltaObj?.stop_reason as string) || 'end_turn'
            const unifiedReason = mapToStopReason(rawReason)
            const usage = parsed.usage as Record<string, unknown>

            // Store finish state for flush()
            state.finishReason = rawReason
            if (usage) {
              state.finalUsage = {
                inputTokens: 0,
                outputTokens: (usage.output_tokens as number) || 0,
              }
            }

            return {
              type: 'finish',
              finishReason: { unified: unifiedReason, raw: rawReason },
              usage: usage
                ? {
                    inputTokens: 0,
                    outputTokens: (usage.output_tokens as number) || 0,
                  }
                : undefined,
            }
          }

          if (parsed.type === 'message_stop') {
            return {
              type: 'finish',
              finishReason: { unified: 'end_turn', raw: 'message_stop' },
            }
          }

          return null
        }

        // 2. Check for Antigravity/Gemini wrapped format
        state.detectedFormat = 'gemini'

        let geminiChunk = parsed
        if (parsed.response && typeof parsed.response === 'object') {
          geminiChunk = parsed.response as Record<string, unknown>
        }

        // If it looks like Gemini candidates
        if (geminiChunk.candidates && Array.isArray(geminiChunk.candidates)) {
          const candidate = geminiChunk.candidates[0] as Record<string, unknown> | undefined
          if (!candidate) return null

          const chunks: StreamChunk[] = []
          const content = candidate.content as Record<string, unknown> | undefined
          if (content?.parts && Array.isArray(content.parts)) {
            for (const part of content.parts) {
              const p = part as Record<string, unknown>
              if (p.text !== undefined && typeof p.text === 'string') {
                // If it has thought, it's thinking delta
                if (p.thought) {
                  chunks.push({
                    type: 'thinking-delta',
                    delta: {
                      thinking: {
                        text: p.text,
                      },
                    },
                  })
                } else {
                  chunks.push({
                    type: 'text-delta',
                    delta: { text: p.text },
                  })
                }
              } else if (p.functionCall && typeof p.functionCall === 'object') {
                const fc = p.functionCall as Record<string, unknown>
                chunks.push({
                  type: 'tool-call-start',
                  toolCall: {
                    id: (fc.id as string) || `call_${crypto.randomUUID()}`,
                    name: (fc.name as string) || 'unknown',
                  },
                })
                const argsStr =
                  typeof fc.args === 'string' ? (fc.args as string) : JSON.stringify(fc.args)
                chunks.push({
                  type: 'tool-input-delta',
                  delta: { partialJson: argsStr },
                })
                chunks.push({ type: 'tool-call-end' })
              }
            }
          }

          if (candidate.finishReason && typeof candidate.finishReason === 'string') {
            const unifiedReason = mapToStopReason(candidate.finishReason)
            // Store finish state for flush()
            state.finishReason = candidate.finishReason
            chunks.push({
              type: 'finish',
              finishReason: { unified: unifiedReason, raw: candidate.finishReason },
            })
          }

          const usageMetadata = geminiChunk.usageMetadata as Record<string, unknown> | undefined
          if (usageMetadata) {
            // Store final usage for flush()
            state.finalUsage = {
              inputTokens: (usageMetadata.promptTokenCount as number) || 0,
              outputTokens: (usageMetadata.candidatesTokenCount as number) || 0,
            }
            chunks.push({
              type: 'usage',
              usage: state.finalUsage,
            })
          }

          return chunks.length > 0 ? chunks : null
        }

        return null
      } catch {
        return null
      }
    },

    build(chunk: StreamChunk | StreamChunk[]): string | string[] | null {
      const chunks = Array.isArray(chunk) ? chunk : [chunk]
      const results: string[] = []

      for (const c of chunks) {
        // Auto-emit message_start on first content block (Anthropic format)
        if (
          !state.messageStartGenerated &&
          (c.type === 'text-delta' || c.type === 'thinking-start' || c.type === 'thinking-delta')
        ) {
          const msgId = `msg_${Math.random().toString(36).slice(2, 11)}`
          const msgStart = {
            type: 'message_start',
            message: {
              id: msgId,
              type: 'message',
              role: 'assistant',
              content: [],
              model,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          }
          results.push(formatSSEEvent('message_start', msgStart))
          state.messageStartGenerated = true
        }

        // Convert StreamChunk to Anthropic SSE (prefer Anthropic format for consistency)
        if (c.type === 'text-delta' && c.delta?.text) {
          const evt = {
            type: 'content_block_delta',
            index: c.blockIndex || 0,
            delta: { type: 'text_delta', text: c.delta.text },
          }
          results.push(formatSSEEvent('content_block_delta', evt))
        } else if (c.type === 'thinking-delta' && c.delta?.thinking) {
          const evt = {
            type: 'content_block_delta',
            index: c.blockIndex || 0,
            delta: { type: 'thinking_delta', thinking: c.delta.thinking.text },
          }
          results.push(formatSSEEvent('content_block_delta', evt))
        } else if (c.type === 'tool-input-delta' && c.delta?.partialJson) {
          const evt = {
            type: 'content_block_delta',
            index: c.blockIndex || 0,
            delta: { type: 'input_json_delta', partial_json: c.delta.partialJson },
          }
          results.push(formatSSEEvent('content_block_delta', evt))
        } else if (c.type === 'finish' && c.finishReason) {
          let stopReason = c.finishReason.raw || c.finishReason.unified
          if (state.hasToolUseBlock && stopReason === 'end_turn') {
            stopReason = 'tool_use'
          }

          const usageSource = c.usage || state.finalUsage || { inputTokens: 0, outputTokens: 0 }
          const usage = {
            input_tokens: usageSource.inputTokens || 0,
            output_tokens: usageSource.outputTokens || 0,
          }

          const evt = {
            type: 'message_delta',
            delta: { stop_reason: stopReason },
            usage,
          }
          results.push(formatSSEEvent('message_delta', evt))

          // Also emit message_stop after message_delta
          const msgStop = { type: 'message_stop' }
          results.push(formatSSEEvent('message_stop', msgStop))

          // Mark that we've already emitted message_stop in build()
          state.messageStopEmitted = true
        } else if (c.type === 'usage' && c.usage) {
          state.finalUsage = {
            inputTokens: c.usage.inputTokens,
            outputTokens: c.usage.outputTokens,
          }
        } else if (c.type === 'block_stop') {
          // Skip block_stop - will be handled in flush()
        }
      }

      return results.length > 0 ? results : null
    },

    filter(output: string): boolean {
      // Allow first message_start that we generated in build()
      // Skip any subsequent auto-generated message_start (from duplicate transformations)
      if (output.includes('"type":"message_start"')) {
        // Only skip if we've already filtered one message_start before
        if (state.messageStartFiltered) {
          return false
        }
        // First one passes through
        state.messageStartFiltered = true
        return true
      }
      return true
    },

    flush(): string | null {
      const results: string[] = []

      // Emit final block_stop if there's an open block
      if (state.currentBlockType) {
        const evt = {
          type: 'content_block_stop',
          index: state.currentBlockIndex,
        }
        results.push(formatSSEEvent('content_block_stop', evt))
      }

      // Emit message_delta with final stop_reason and usage (if we received a finish event)
      if (state.finishReason && !state.messageStopEmitted) {
        let stopReason = state.finishReason
        if (state.hasToolUseBlock && stopReason === 'end_turn') {
          stopReason = 'tool_use'
        }

        const msgDelta = {
          type: 'message_delta',
          delta: { stop_reason: stopReason },
          usage: state.finalUsage || { input_tokens: 0, output_tokens: 0 },
        }
        results.push(formatSSEEvent('message_delta', msgDelta))
      }

      // Emit message_stop at the end (only once)
      if (!state.messageStopEmitted) {
        const msgStop = { type: 'message_stop' }
        results.push(formatSSEEvent('message_stop', msgStop))
        state.messageStopEmitted = true
      }

      return results.length > 0 ? results.join('') : null
    },

    accumulateToJson: async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> => {
      const rawAggregated = await accumulateGeminiResponse(reader)
      // Gemini SSE accumulation logic from response-factory:
      // Wrap in { response: ... } as Antigravity/Gemini expects
      return { response: rawAggregated }
    },
  }
}
