import type { StreamChunk } from '../../types/unified'
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
    const results: string[] = []

    for (const c of chunks) {
      // Auto-emit message_start on first content block (Anthropic format)
      if (
        !this.state.messageStartGenerated &&
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
