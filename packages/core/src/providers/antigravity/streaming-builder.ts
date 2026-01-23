import type { StreamChunk } from '../../types/unified'
import { normalizeStreamingOrder, type StreamingState } from '../../util/stream-normalizer'
import { formatSSEEvent } from './streaming-utils'

export interface AntigravityBuilderState {
  messageStartGenerated: boolean
  currentBlockType: 'thinking' | 'text' | 'tool_use' | null
  currentBlockIndex: number
  hasToolUseBlock: boolean
  finishReason: string | null
  finalUsage: { inputTokens: number; outputTokens: number } | null
  messageStopEmitted: boolean
  messageStartFiltered: boolean
  streamingState: StreamingState
}

export class AntigravityStreamingBuilder {
  private state: AntigravityBuilderState
  private model: string

  constructor(state: AntigravityBuilderState, model: string) {
    this.state = state
    this.model = model
  }

  build(chunk: StreamChunk | StreamChunk[]): string | string[] | null {
    const chunks = Array.isArray(chunk) ? chunk : [chunk]

    // Normalize event order first
    const { events: normalizedEvents, newState } = normalizeStreamingOrder(
      chunks,
      this.state.streamingState
    )
    this.state.streamingState = newState

    const results: string[] = []

    for (const c of normalizedEvents) {
      // Auto-emit message_start on first content block (Anthropic format)
      if (
        !this.state.messageStartGenerated &&
        (c.type === 'text-delta' ||
          c.type === 'content' ||
          c.type === 'thinking-start' ||
          c.type === 'thinking-delta' ||
          c.type === 'tool-call-start' ||
          c.type === 'tool-input-delta' ||
          // Handle tool_call (from Gemini/Antigravity generic parser)
          c.type === 'tool_call')
      ) {
        const msgId = `msg_${Math.random().toString(36).slice(2, 11)}`
        const msgStart = {
          type: 'message_start',
          message: {
            id: msgId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: this.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }
        results.push(formatSSEEvent('message_start', msgStart))
        this.state.messageStartGenerated = true
      }

      // Convert StreamChunk to Anthropic SSE (prefer Anthropic format for consistency)
      if ((c.type === 'text-delta' || c.type === 'content') && c.delta?.text) {
        // Automatically start text block if not started
        if (this.state.currentBlockType !== 'text') {
          // If we were in another block, stop it first
          if (this.state.currentBlockType) {
            const stopEvt = {
              type: 'content_block_stop',
              index: this.state.currentBlockIndex,
            }
            results.push(formatSSEEvent('content_block_stop', stopEvt))
            this.state.currentBlockIndex++
          }

          // Start new text block
          this.state.currentBlockType = 'text'
          const startEvt = {
            type: 'content_block_start',
            index: this.state.currentBlockIndex,
            content_block: { type: 'text', text: '' },
          }
          results.push(formatSSEEvent('content_block_start', startEvt))
        }

        const evt = {
          type: 'content_block_delta',
          index: this.state.currentBlockIndex,
          delta: { type: 'text_delta', text: c.delta.text },
        }
        results.push(formatSSEEvent('content_block_delta', evt))
      } else if (c.type === 'thinking-delta' && c.delta?.thinking) {
        // Automatically start thinking block if not started
        if (this.state.currentBlockType !== 'thinking') {
          // If we were in another block, stop it first
          if (this.state.currentBlockType) {
            const stopEvt = {
              type: 'content_block_stop',
              index: this.state.currentBlockIndex,
            }
            results.push(formatSSEEvent('content_block_stop', stopEvt))
            this.state.currentBlockIndex++
          }

          // Start new thinking block
          this.state.currentBlockType = 'thinking'
          const startEvt = {
            type: 'content_block_start',
            index: this.state.currentBlockIndex,
            content_block: { type: 'thinking', thinking: '' },
          }
          results.push(formatSSEEvent('content_block_start', startEvt))
        }

        const evt = {
          type: 'content_block_delta',
          index: this.state.currentBlockIndex,
          delta: { type: 'thinking_delta', thinking: c.delta.thinking.text },
        }
        results.push(formatSSEEvent('content_block_delta', evt))

        if (c.delta.thinking.signature) {
          const sigEvt = {
            type: 'content_block_delta',
            index: this.state.currentBlockIndex,
            delta: {
              type: 'signature_delta',
              signature: c.delta.thinking.signature,
            },
          }
          results.push(formatSSEEvent('content_block_delta', sigEvt))
        }
      } else if (c.type === 'thinking-start') {
        // Explicit thinking start
        if (this.state.currentBlockType) {
          const stopEvt = {
            type: 'content_block_stop',
            index: this.state.currentBlockIndex,
          }
          results.push(formatSSEEvent('content_block_stop', stopEvt))
          this.state.currentBlockIndex++
        }

        this.state.currentBlockType = 'thinking'
        const startEvt = {
          type: 'content_block_start',
          index: this.state.currentBlockIndex,
          content_block: { type: 'thinking', thinking: '' },
        }
        results.push(formatSSEEvent('content_block_start', startEvt))
      } else if (c.type === 'thinking-end') {
        // Explicit thinking end
        if (this.state.currentBlockType === 'thinking') {
          const stopEvt = {
            type: 'content_block_stop',
            index: this.state.currentBlockIndex,
          }
          results.push(formatSSEEvent('content_block_stop', stopEvt))
          this.state.currentBlockType = null
          this.state.currentBlockIndex++
        }
      } else if (
        (c.type === 'tool-call-start' && c.toolCall) ||
        (c.type === 'tool_call' && c.delta?.toolCall)
      ) {
        // Automatically start tool_use block if not started
        if (this.state.currentBlockType !== 'tool_use') {
          // If we were in another block, stop it first
          if (this.state.currentBlockType) {
            const stopEvt = {
              type: 'content_block_stop',
              index: this.state.currentBlockIndex,
            }
            results.push(formatSSEEvent('content_block_stop', stopEvt))
            this.state.currentBlockIndex++
          }

          // Start new tool_use block
          this.state.currentBlockType = 'tool_use'
          this.state.hasToolUseBlock = true

          // Handle both tool-call-start (explicit) and tool_call (generic/delta)
          const toolCall = c.type === 'tool-call-start' ? c.toolCall : c.delta?.toolCall

          if (toolCall) {
            const startEvt = {
              type: 'content_block_start',
              index: this.state.currentBlockIndex,
              content_block: {
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.name,
                input: {},
              },
            }
            results.push(formatSSEEvent('content_block_start', startEvt))
          }
        }
      } else if (c.type === 'tool-input-delta' && c.delta?.partialJson) {
        const evt = {
          type: 'content_block_delta',
          index: c.blockIndex || 0,
          delta: { type: 'input_json_delta', partial_json: c.delta.partialJson },
        }
        results.push(formatSSEEvent('content_block_delta', evt))
      } else if (c.type === 'finish' && c.finishReason) {
        let stopReason = c.finishReason.raw || c.finishReason.unified
        if (this.state.hasToolUseBlock && stopReason === 'end_turn') {
          stopReason = 'tool_use'
        }

        const usageSource = c.usage || this.state.finalUsage || { inputTokens: 0, outputTokens: 0 }
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
        this.state.messageStopEmitted = true
      } else if (c.type === 'usage' && c.usage) {
        this.state.finalUsage = {
          inputTokens: c.usage.inputTokens,
          outputTokens: c.usage.outputTokens,
        }
      } else if (c.type === 'block_stop') {
        // Skip block_stop - will be handled in flush()
      }
    }

    return results.length > 0 ? results : null
  }

  flush(): string | null {
    const results: string[] = []

    // Emit final block_stop if there's an open block
    if (this.state.currentBlockType) {
      const evt = {
        type: 'content_block_stop',
        index: this.state.currentBlockIndex,
      }
      results.push(formatSSEEvent('content_block_stop', evt))
    }

    // Emit message_delta with final stop_reason and usage (if we received a finish event)
    if (this.state.finishReason && !this.state.messageStopEmitted) {
      let stopReason = this.state.finishReason
      if (this.state.hasToolUseBlock && stopReason === 'end_turn') {
        stopReason = 'tool_use'
      }

      const msgDelta = {
        type: 'message_delta',
        delta: { stop_reason: stopReason },
        usage: this.state.finalUsage || { input_tokens: 0, output_tokens: 0 },
      }
      results.push(formatSSEEvent('message_delta', msgDelta))
    }

    // Emit message_stop at the end (only once)
    if (!this.state.messageStopEmitted) {
      const msgStop = { type: 'message_stop' }
      results.push(formatSSEEvent('message_stop', msgStop))
      this.state.messageStopEmitted = true
    }

    return results.length > 0 ? results.join('') : null
  }

  filter(output: string): boolean {
    // Allow first message_start that we generated in build()
    // Skip any subsequent auto-generated message_start (from duplicate transformations)
    if (output.includes('"type":"message_start"')) {
      // Only skip if we've already filtered one message_start before
      if (this.state.messageStartFiltered) {
        return false
      }
      // First one passes through
      this.state.messageStartFiltered = true
      return true
    }
    return true
  }
}
