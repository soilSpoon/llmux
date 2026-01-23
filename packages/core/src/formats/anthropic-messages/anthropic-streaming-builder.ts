import crypto from 'node:crypto'
import type { JsonObject, StreamChunk } from '../../types/unified'
import { normalizeStreamingOrder, type StreamingState } from '../../util/stream-normalizer'
import { formatSSE } from './streaming'

interface BuilderState {
  phase: 'idle' | 'message_started' | 'block_started' | 'finished'
  currentBlockType: 'text' | 'thinking' | 'tool_use' | 'redacted_thinking' | null
  currentBlockIndex: number
  messageId: string
  hasToolUseBlock: boolean
  currentToolName: string
  currentToolId: string
  streamingState: StreamingState
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: JsonObject }

/**
 * Anthropic Streaming Builder
 *
 * Converts unified StreamChunks into Anthropic SSE events.
 * Maintains state to ensure strict event ordering:
 * message_start -> content_block_start -> content_block_delta -> content_block_stop -> message_delta -> message_stop
 */
export class AnthropicStreamingBuilder {
  private state: BuilderState

  constructor(private model: string) {
    this.state = {
      phase: 'idle',
      currentBlockType: null,
      currentBlockIndex: 0,
      messageId: `msg_${Math.random().toString(36).slice(2, 11)}`,
      hasToolUseBlock: false,
      currentToolName: '',
      currentToolId: '',
      streamingState: {
        hasThinkingStarted: false,
        hasThinkingEnded: false,
        hasTextStarted: false,
      },
    }
  }

  /**
   * Build Anthropic SSE events from a unified StreamChunk
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
      // 1. Auto-emit message_start on first chunk
      if (this.state.phase === 'idle') {
        const msgStart = {
          type: 'message_start',
          message: {
            id: this.state.messageId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: this.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }
        results.push(formatSSE('message_start', msgStart))
        this.state.phase = 'message_started'
      }

      // Handle finish/done chunks
      if (normalizedChunk.type === 'finish' || normalizedChunk.type === 'done') {
        results.push(...this.handleFinish(normalizedChunk))
        continue
      }

      // Handle error chunks
      if (normalizedChunk.type === 'error') {
        const errorEvent = {
          type: 'error',
          error: {
            type: 'overloaded_error',
            message: normalizedChunk.error || 'Unknown error',
          },
        }
        results.push(formatSSE('error', errorEvent))
        continue // Errors stop processing for this chunk
      }

      // Handle content/block chunks
      if (this.needsBlockStart(normalizedChunk)) {
        if (this.state.phase === 'block_started') {
          // Close previous block
          results.push(
            formatSSE('content_block_stop', {
              type: 'content_block_stop',
              index: this.state.currentBlockIndex,
            })
          )

          // Start new block
          const prevIndex = this.state.currentBlockIndex
          this.state.currentBlockIndex++ // Auto-increment for the new block

          // If the chunk specifically provides a higher index, use it.
          // Otherwise, our auto-incremental index ensures uniqueness.
          if (normalizedChunk.blockIndex !== undefined && normalizedChunk.blockIndex > prevIndex) {
            this.state.currentBlockIndex = normalizedChunk.blockIndex
          }

          results.push(...this.emitBlockStart(normalizedChunk))
        } else {
          // First block start
          results.push(...this.emitBlockStart(normalizedChunk))
          this.state.phase = 'block_started'
        }
      }

      // Emit delta
      const deltaEvents = this.buildContentBlockDelta(normalizedChunk)
      results.push(...deltaEvents)

      // Handle implicit finish in content chunk (common in Gemini/Antigravity)
      // Only trigger if we have a stopReason (Gemini sends usage on every chunk, but stopReason only on last)
      const rawStopReason = normalizedChunk.finishReason?.raw || normalizedChunk.stopReason
      if (rawStopReason) {
        if (this.state.phase === 'block_started') {
          results.push(
            formatSSE('content_block_stop', {
              type: 'content_block_stop',
              index: this.state.currentBlockIndex,
            })
          )
          this.state.phase = 'message_started'
        }

        let unifiedReason =
          normalizedChunk.finishReason?.unified || normalizedChunk.stopReason || 'end_turn'

        // Patch stop_reason: if we had a tool_use block, stop_reason should be 'tool_use'
        // (Gemini sends 'end_turn' even for tool calls)
        if (
          this.state.hasToolUseBlock &&
          (unifiedReason === 'end_turn' || unifiedReason === null)
        ) {
          unifiedReason = 'tool_use'
        }

        const usage = {
          input_tokens: normalizedChunk.usage?.inputTokens || 0,
          output_tokens: normalizedChunk.usage?.outputTokens || 0,
        }

        const msgDelta = {
          type: 'message_delta',
          delta: {
            stop_reason: unifiedReason,
            stop_sequence: null,
          },
          usage,
        }
        results.push(formatSSE('message_delta', msgDelta))

        const msgStop = { type: 'message_stop' }
        results.push(formatSSE('message_stop', msgStop))

        this.state.phase = 'finished'
      }
    }

    return results
  }

  /**
   * Finalize the stream (close open blocks, etc.)
   * CRITICAL: Must guarantee message_stop is emitted for proper stream termination
   */
  flush(): string[] {
    // If already finished, return empty
    if (this.state.phase === 'finished') {
      return []
    }
    const results: string[] = []

    // Close any open block first
    if (this.state.phase === 'block_started') {
      results.push(
        formatSSE('content_block_stop', {
          type: 'content_block_stop',
          index: this.state.currentBlockIndex,
        })
      )
    }

    // CRITICAL: If we haven't finished properly (no finish/done chunk received),
    // we must still emit message_delta and message_stop to prevent client hanging.
    // This handles cases where upstream terminates without sending a proper finish signal.
    if (this.state.phase !== 'idle') {
      // Determine stop reason - if we had tool_use blocks, use 'tool_use'
      const stopReason = this.state.hasToolUseBlock ? 'tool_use' : 'end_turn'

      results.push(
        formatSSE('message_delta', {
          type: 'message_delta',
          delta: {
            stop_reason: stopReason,
            stop_sequence: null,
          },
          usage: { input_tokens: 0, output_tokens: 0 },
        })
      )

      results.push(formatSSE('message_stop', { type: 'message_stop' }))

      this.state.phase = 'finished'
    }

    return results
  }

  private handleFinish(chunk: StreamChunk): string[] {
    const results: string[] = []
    // Close any open block first
    if (this.state.phase === 'block_started') {
      results.push(
        formatSSE('content_block_stop', {
          type: 'content_block_stop',
          index: this.state.currentBlockIndex,
        })
      )
      this.state.phase = 'message_started' // Back to message level
    }

    const rawReason = chunk.finishReason?.raw || chunk.stopReason
    let unifiedReason = chunk.finishReason?.unified || chunk.stopReason || 'end_turn'

    // Safety: ensure no raw non-Anthropic reasons leak through
    // Map common non-standard reasons to 'end_turn'
    if (typeof rawReason === 'string') {
      if (['stop', 'STOP', 'finish'].includes(rawReason)) {
        unifiedReason = 'end_turn'
      } else if (['length', 'MAX_TOKENS'].includes(rawReason)) {
        unifiedReason = 'max_tokens'
      } else if (['content_filter', 'SAFETY'].includes(rawReason)) {
        // Anthropic doesn't have content_filter stop reason in message_delta
        // It usually returns end_turn or sends an error.
        unifiedReason = 'end_turn'
      }
    }

    // Patch stop_reason: if we had a tool_use block, stop_reason should be 'tool_use'
    // (Gemini sends 'end_turn' even for tool calls)
    if (this.state.hasToolUseBlock && (unifiedReason === 'end_turn' || unifiedReason === null)) {
      unifiedReason = 'tool_use'
    }

    const usage = {
      input_tokens: chunk.usage?.inputTokens || 0,
      output_tokens: chunk.usage?.outputTokens || 0,
    }

    const msgDelta = {
      type: 'message_delta',
      delta: { stop_reason: unifiedReason },
      usage,
    }
    results.push(formatSSE('message_delta', msgDelta))

    const msgStop = { type: 'message_stop' }
    results.push(formatSSE('message_stop', msgStop))

    this.state.phase = 'finished'

    return results
  }

  private needsBlockStart(chunk: StreamChunk): boolean {
    if (
      chunk.type === 'block_stop' ||
      chunk.type === 'usage' ||
      chunk.type === 'finish' ||
      chunk.type === 'done' ||
      chunk.type === 'error'
    ) {
      return false
    }

    // If we haven't started any block, we need one
    if (this.state.phase !== 'block_started') return true

    // If block type changes, we need start
    const type = this.getBlockType(chunk)
    if (type !== this.state.currentBlockType) return true

    // For tool_use, even if type is same, if tool name/id changes, it's a new block
    if (type === 'tool_use') {
      const toolCall = chunk.toolCall || chunk.delta?.toolCall
      if (toolCall) {
        if (toolCall.name !== this.state.currentToolName) return true
        // If we have an explicit ID and it's different, it's a new block
        if (toolCall.id && toolCall.id !== this.state.currentToolId) return true
      }
    }

    return false
  }

  private getBlockType(chunk: StreamChunk): 'text' | 'thinking' | 'tool_use' | 'redacted_thinking' {
    if (chunk.type === 'redacted-thinking') return 'redacted_thinking'
    if (
      chunk.type === 'thinking' ||
      chunk.type === 'thinking-start' ||
      chunk.type === 'thinking-delta'
    )
      return 'thinking'
    if (
      chunk.type === 'tool_call' ||
      chunk.type === 'tool-call-start' ||
      chunk.type === 'tool-input-delta'
    )
      return 'tool_use'
    return 'text' // Default to text for content/text-delta
  }

  private emitBlockStart(chunk: StreamChunk): string[] {
    const type = this.getBlockType(chunk)
    this.state.currentBlockType = type

    let content_block: AnthropicContentBlock

    if (type === 'text') {
      content_block = { type: 'text', text: '' } // Start empty
    } else if (type === 'thinking') {
      content_block = { type: 'thinking', thinking: '' } // Start empty
    } else if (type === 'redacted_thinking') {
      content_block = { type: 'redacted_thinking', data: chunk.delta?.redactedThinking || '' }
    } else {
      // tool_use
      // Track that we have emitted a tool_use block (for stop_reason patching)
      this.state.hasToolUseBlock = true
      // For tool_use, we typically get name/id in tool-call-start (chunk.toolCall)
      // or from google-gemini format (chunk.delta.toolCall)
      const toolCall = chunk.toolCall || chunk.delta?.toolCall
      const name = toolCall?.name || 'unknown'
      const id = toolCall?.id || `call_${crypto.randomUUID()}`

      this.state.currentToolName = name
      this.state.currentToolId = id

      content_block = {
        type: 'tool_use',
        id,
        name,
        input: {}, // Start empty input
      }
    }

    return [
      formatSSE('content_block_start', {
        type: 'content_block_start',
        index: this.state.currentBlockIndex,
        content_block,
      }),
    ]
  }

  private buildContentBlockDelta(chunk: StreamChunk): string[] {
    const events: string[] = []

    if ((chunk.type === 'text-delta' || chunk.type === 'content') && chunk.delta?.text) {
      events.push(
        formatSSE('content_block_delta', {
          type: 'content_block_delta',
          index: this.state.currentBlockIndex,
          delta: { type: 'text_delta', text: chunk.delta.text },
        })
      )
    } else if (
      (chunk.type === 'thinking-delta' || chunk.type === 'thinking') &&
      chunk.delta?.thinking
    ) {
      const thinking = chunk.delta.thinking
      if (thinking.text) {
        events.push(
          formatSSE('content_block_delta', {
            type: 'content_block_delta',
            index: this.state.currentBlockIndex,
            delta: { type: 'thinking_delta', thinking: thinking.text },
          })
        )
      }
      if (thinking.signature) {
        events.push(
          formatSSE('content_block_delta', {
            type: 'content_block_delta',
            index: this.state.currentBlockIndex,
            delta: { type: 'signature_delta', signature: thinking.signature },
          })
        )
      }
    } else if (
      (chunk.type === 'tool-input-delta' || chunk.type === 'tool_call') &&
      chunk.delta?.partialJson
    ) {
      events.push(
        formatSSE('content_block_delta', {
          type: 'content_block_delta',
          index: this.state.currentBlockIndex,
          delta: { type: 'input_json_delta', partial_json: chunk.delta.partialJson },
        })
      )
    }

    return events
  }
}
