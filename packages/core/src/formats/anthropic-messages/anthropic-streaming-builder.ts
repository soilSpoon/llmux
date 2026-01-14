import crypto from 'node:crypto'
import type { StreamChunk } from '../../types/unified'
import { formatSSE } from './streaming'

/**
 * Anthropic Streaming Builder
 *
 * Converts unified StreamChunks into Anthropic SSE events.
 * Maintains state to ensure strict event ordering:
 * message_start -> content_block_start -> content_block_delta -> content_block_stop -> message_delta -> message_stop
 */
export class AnthropicStreamingBuilder {
  private state = {
    phase: 'idle' as 'idle' | 'message_started' | 'block_started' | 'finished',
    currentBlockType: null as 'text' | 'thinking' | 'tool_use' | null,
    currentBlockIndex: 0,
    messageId: '',
    accumulatedToolInput: '', // For merging partial JSON if needed
    hasToolUseBlock: false, // Track if any tool_use block was emitted
    currentToolName: '', // Track current tool name to detect changes
    currentToolId: '', // Track current tool id to detect changes
  }

  constructor(private model: string) {
    this.state.messageId = `msg_${Math.random().toString(36).slice(2, 11)}`
  }

  /**
   * Build Anthropic SSE events from a unified StreamChunk
   */
  build(chunk: StreamChunk): string[] {
    if (this.state.phase === 'finished') {
      return []
    }

    const results: string[] = []

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
    if (chunk.type === 'finish' || chunk.type === 'done') {
      return this.handleFinish(chunk, results)
    }

    // Handle error chunks
    if (chunk.type === 'error') {
      const errorEvent = {
        type: 'error',
        error: {
          type: 'overloaded_error',
          message: chunk.error || 'Unknown error',
        },
      }
      results.push(formatSSE('error', errorEvent))
      return results
    }

    // Handle content/block chunks
    if (this.needsBlockStart(chunk)) {
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
        if (chunk.blockIndex !== undefined && chunk.blockIndex > prevIndex) {
          this.state.currentBlockIndex = chunk.blockIndex
        }

        results.push(...this.emitBlockStart(chunk))
      } else {
        // First block start
        results.push(...this.emitBlockStart(chunk))
        this.state.phase = 'block_started'
      }
    }

    // Emit delta
    const deltaEvents = this.buildContentBlockDelta(chunk)
    results.push(...deltaEvents)

    // Handle implicit finish in content chunk (common in Gemini/Antigravity)
    // Only trigger if we have a stopReason (Gemini sends usage on every chunk, but stopReason only on last)
    if (chunk.stopReason) {
      if (this.state.phase === 'block_started') {
        results.push(
          formatSSE('content_block_stop', {
            type: 'content_block_stop',
            index: this.state.currentBlockIndex,
          })
        )
        this.state.phase = 'message_started'
      }

      let unifiedReason = chunk.stopReason || 'end_turn'

      // Patch stop_reason: if we had a tool_use block, stop_reason should be 'tool_use'
      // (Gemini sends 'end_turn' even for tool calls)
      if (this.state.hasToolUseBlock && unifiedReason === 'end_turn') {
        unifiedReason = 'tool_use'
      }

      const usage = {
        input_tokens: chunk.usage?.inputTokens || 0,
        output_tokens: chunk.usage?.outputTokens || 0,
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

  private handleFinish(chunk: StreamChunk, results: string[]): string[] {
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

    let unifiedReason = chunk.finishReason?.unified || chunk.stopReason || 'end_turn'

    // Patch stop_reason: if we had a tool_use block, stop_reason should be 'tool_use'
    // (Gemini sends 'end_turn' even for tool calls)
    if (this.state.hasToolUseBlock && unifiedReason === 'end_turn') {
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
        // Note: For providers that stream partial tool usage without IDs in subsequent chunks,
        // we must be careful. But typically a new tool_call start provides an ID.
        if (toolCall.id && toolCall.id !== this.state.currentToolId) return true
      }
    }

    return false
  }

  private getBlockType(chunk: StreamChunk): 'text' | 'thinking' | 'tool_use' {
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

    const content_block: Record<string, unknown> = { type }

    if (type === 'text') {
      content_block.text = '' // Start empty
    } else if (type === 'thinking') {
      content_block.thinking = '' // Start empty
    } else if (type === 'tool_use') {
      // Track that we have emitted a tool_use block (for stop_reason patching)
      this.state.hasToolUseBlock = true
      // For tool_use, we typically get name/id in tool-call-start (chunk.toolCall)
      // or from google-gemini format (chunk.delta.toolCall)
      const toolCall = chunk.toolCall || chunk.delta?.toolCall
      content_block.name = toolCall?.name || 'unknown'
      content_block.id = toolCall?.id || `call_${crypto.randomUUID()}`
      content_block.input = {} // Start empty input
      this.state.currentToolName = content_block.name as string
      this.state.currentToolId = content_block.id as string
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
      chunk.delta?.thinking?.text
    ) {
      events.push(
        formatSSE('content_block_delta', {
          type: 'content_block_delta',
          index: this.state.currentBlockIndex,
          delta: { type: 'thinking_delta', thinking: chunk.delta.thinking.text },
        })
      )
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
