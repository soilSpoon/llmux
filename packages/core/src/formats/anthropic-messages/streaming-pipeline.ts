import type { StopReason, StreamChunk, StreamingPipeline } from '../../types/unified'

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
 * Map Anthropic stop reasons to unified StopReason type
 */
function mapToStopReason(anthropicReason: string | null | undefined): StopReason {
  if (!anthropicReason) return 'end_turn'

  if (isStopReason(anthropicReason)) {
    return anthropicReason
  }

  if (anthropicReason === 'end_turn' || anthropicReason === 'message_stop') {
    return 'end_turn'
  }
  if (anthropicReason === 'tool_use') {
    return 'tool_use'
  }
  if (anthropicReason === 'max_tokens') {
    return 'max_tokens'
  }
  if (anthropicReason === 'stop_sequence') {
    return 'stop_sequence'
  }

  return 'end_turn'
}

/**
 * AnthropicStreamingPipeline - Anthropic-specific streaming transformation.
 *
 * Handles:
 * 1. Parsing Anthropic SSE events (message_start, content_block_*, message_*)
 * 2. Building Unified StreamChunks back to Anthropic format
 * 3. Filtering duplicate/auto-generated message_start events
 * 4. Flushing final state (block_stop) when stream ends
 */
export function createAnthropicStreamingPipeline(model: string): StreamingPipeline {
  const state = {
    messageStartSent: false,
    currentBlockType: null as 'thinking' | 'text' | 'tool_use' | null,
    currentBlockIndex: 0,
    hasToolUseBlock: false,
  }

  return {
    parse(chunk: string): StreamChunk | StreamChunk[] | null {
      try {
        if (!chunk.trim() || chunk.includes('[DONE]')) {
          return null
        }

        const cleaned = chunk.replace(/^data:\s*/, '').trim()
        if (!cleaned) {
          return null
        }

        const parsed = JSON.parse(cleaned) as Record<string, unknown>

        // Anthropic message_start event
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

        // Anthropic content_block_start event
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

        // Anthropic content_block_delta event
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

        // Anthropic content_block_stop event
        if (parsed.type === 'content_block_stop') {
          return { type: 'block_stop' }
        }

        // Anthropic message_delta event
        if (parsed.type === 'message_delta') {
          const deltaObj = parsed.delta as Record<string, unknown>
          const rawReason = (deltaObj?.stop_reason as string) || 'end_turn'
          const unifiedReason = mapToStopReason(rawReason)
          const usage = parsed.usage as Record<string, unknown>

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

        // Anthropic message_stop event
        if (parsed.type === 'message_stop') {
          return {
            type: 'finish',
            finishReason: { unified: 'end_turn', raw: 'message_stop' },
          }
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
        // Auto-emit message_start on first content block
        if (
          !state.messageStartSent &&
          (c.type === 'text-delta' ||
            c.type === 'thinking-start' ||
            c.type === 'thinking-delta' ||
            c.type === 'tool-call-start' ||
            c.type === 'tool-input-delta')
        ) {
          const msgId = `msg_${Math.random().toString(36).slice(2, 11)}`
          const msgStart = JSON.stringify({
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
          })
          results.push(`data: ${msgStart}\n\n`)
          state.messageStartSent = true
        }

        // Convert StreamChunk to Anthropic SSE
        if (c.type === 'text-delta' && c.delta?.text) {
          const evt = JSON.stringify({
            type: 'content_block_delta',
            index: c.blockIndex || 0,
            delta: { type: 'text_delta', text: c.delta.text },
          })
          results.push(`data: ${evt}\n\n`)
        } else if (c.type === 'thinking-delta' && c.delta?.thinking) {
          const evt = JSON.stringify({
            type: 'content_block_delta',
            index: c.blockIndex || 0,
            delta: { type: 'thinking_delta', thinking: c.delta.thinking.text },
          })
          results.push(`data: ${evt}\n\n`)
        } else if (c.type === 'tool-input-delta' && c.delta?.partialJson) {
          const evt = JSON.stringify({
            type: 'content_block_delta',
            index: c.blockIndex || 0,
            delta: { type: 'input_json_delta', partial_json: c.delta.partialJson },
          })
          results.push(`data: ${evt}\n\n`)
        } else if (c.type === 'tool-call-start' && c.toolCall) {
          // Track that we have a tool use block for stop_reason patching
          state.hasToolUseBlock = true

          const evt = JSON.stringify({
            type: 'content_block_start',
            index: c.blockIndex || 0,
            content_block: {
              type: 'tool_use',
              id: c.toolCall.id,
              name: c.toolCall.name,
              input: {},
            },
          })
          results.push(`data: ${evt}\n\n`)
        } else if (c.type === 'finish' && c.finishReason) {
          // Patch stop_reason for tool_use blocks
          // If there's an open tool_use block and stop_reason is end_turn,
          // change it to tool_use (Gemini sends end_turn for tool calls)
          let stopReason = c.finishReason.raw || c.finishReason.unified
          if (state.hasToolUseBlock && stopReason === 'end_turn') {
            stopReason = 'tool_use'
          }

          const evt = JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: stopReason },
            usage: c.usage || { input_tokens: 0, output_tokens: 0 },
          })
          results.push(`data: ${evt}\n\n`)
        } else if (c.type === 'usage') {
          // Skip usage - will be included in message_start
          // (nothing to do)
        } else if (c.type === 'block_stop') {
          // Skip block_stop - will be handled in flush()
          // (nothing to do)
        }
      }

      return results.length > 0 ? results : null
    },

    filter(output: string): boolean {
      // Skip auto-generated message_start in transformed chunks
      // (because build() already emitted it on first content block)
      if (output.includes('"type":"message_start"')) {
        return false
      }
      return true
    },

    flush(): string | null {
      // Emit final block_stop if there's an open block
      if (state.currentBlockType) {
        const evt = JSON.stringify({
          type: 'content_block_stop',
          index: state.currentBlockIndex,
        })
        return `data: ${evt}\n\n`
      }
      return null
    },
  }
}
