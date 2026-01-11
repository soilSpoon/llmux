import type { ResponseMetadata, StreamChunk } from '../../types/unified'
import type { ResponsesOutputItem, ResponsesResponse } from './types'

/**
 * OpenAIResponsesStreamingBuilder
 *
 * Converts unified StreamChunks into OpenAI Responses API (Realtime) SSE events.
 * Maintains state to ensure strict event ordering and protocol compliance:
 * response.created -> response.in_progress -> response.output_item.added -> deltas -> response.completed
 */
export class OpenAIResponsesStreamingBuilder {
  private state = {
    responseId: '',
    model: 'unknown',
    createdAt: 0,
    hasEmittedCreated: false,
    hasEmittedInProgress: false,
    currentItemIndex: -1, // Start at -1 so first item gets index 0
    currentItemId: '',
    currentItemType: null as 'text' | 'thinking' | 'tool_call' | null,
    currentItemContent: [] as string[], // Accumulate content for item.done
    currentItemArgs: '', // Accumulate args for args.done
    currentItemName: '', // For tool calls
    currentItemSignature: undefined as string | undefined, // For thinking signature
    // Track usage to emit in response.completed
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    // Full metadata state
    metadata: undefined as ResponseMetadata | undefined,
    // Sequence number tracking
    nextSequenceNumber: 0,
  }

  constructor(model?: string) {
    this.state.responseId = `resp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    this.state.model = model ?? 'unknown'
    this.state.createdAt = Math.floor(Date.now() / 1000)
  }

  /**
   * Manually set the original response ID and model from upstream.
   * This should be called before the first build() call if possible,
   * but can also be called during parse.
   */
  setOriginalResponseId(id: string, model?: string): void {
    this.state.responseId = id
    if (model) {
      this.state.model = model
    }
  }

  /**
   * Build OpenAI Responses SSE events from a unified StreamChunk
   */
  build(chunk: StreamChunk): string[] {
    const results: string[] = []

    // Handle metadata updates from upstream
    if (chunk.responseMetadata) {
      const meta = chunk.responseMetadata
      if (meta.responseId) {
        this.state.responseId = meta.responseId
      }
      if (meta.id && !meta.responseId) {
        this.state.responseId = meta.id
      }
      if (meta.model) {
        this.state.model = meta.model
      }
      if (meta.createdAt) {
        this.state.createdAt = meta.createdAt
      }

      // Merge full metadata
      this.state.metadata = {
        ...this.state.metadata,
        ...meta,
      }

      // If chunk has top-level obfuscation/logprobs/sequenceNumber, use them
      if (chunk.obfuscation !== undefined) {
        this.state.metadata = {
          ...this.state.metadata,
          obfuscation: chunk.obfuscation,
        }
      }

      // If this was a metadata-only chunk, return empty (already handled state update)
      if (chunk.type === 'done' && chunk.skipStopDelta) {
        return results
      }
    }

    // 1. Auto-emit response.created on first chunk
    if (!this.state.hasEmittedCreated) {
      results.push(
        this.formatEvent('response.created', {
          type: 'response.created',
          response: this.buildResponseObject('in_progress'),
        })
      )
      this.state.hasEmittedCreated = true
    }

    // 2. Auto-emit response.in_progress after response.created
    if (!this.state.hasEmittedInProgress) {
      results.push(
        this.formatEvent('response.in_progress', {
          type: 'response.in_progress',
          response: this.buildResponseObject('in_progress'),
        })
      )
      this.state.hasEmittedInProgress = true
    }

    if (chunk.type === 'done') {
      // Extract usage from done chunk if present
      if (chunk.usage) {
        this.state.usage = {
          inputTokens: chunk.usage.inputTokens ?? 0,
          outputTokens: chunk.usage.outputTokens ?? 0,
          totalTokens: chunk.usage.totalTokens ?? 0,
        }
      }
      return this.handleDone(results)
    }

    if (chunk.type === 'error') {
      return this.handleError(chunk, results)
    }
    if (chunk.type === 'usage') {
      if (chunk.usage) {
        this.state.usage = {
          inputTokens: chunk.usage.inputTokens ?? 0,
          outputTokens: chunk.usage.outputTokens ?? 0,
          totalTokens: chunk.usage.totalTokens ?? 0,
        }
      }
      return results // Usage is emitted at the end in response.completed
    }

    // Determine current chunk's implied item type
    const itemType = this.getItemType(chunk)
    if (!itemType) return results

    // Check if we need to start a new item
    const needsNewItem =
      !this.state.currentItemType ||
      this.state.currentItemType !== itemType ||
      (chunk.blockIndex !== undefined && chunk.blockIndex !== this.state.currentItemIndex)

    if (needsNewItem) {
      // Close previous item if needed
      if (this.state.currentItemType) {
        this.finishItem(results)
      }

      // Start new item
      this.state.currentItemType = itemType
      this.state.currentItemIndex = chunk.blockIndex ?? this.state.currentItemIndex + 1

      // Use provided ID if available, otherwise generate one
      const providedId = chunk.id || chunk.delta?.toolCall?.id || chunk.toolCall?.id
      if (providedId) {
        this.state.currentItemId = providedId
      } else {
        this.state.currentItemId = `msg_${Date.now()}_${this.state.currentItemIndex}`
      }

      this.state.currentItemContent = []
      this.state.currentItemArgs = ''
      this.state.currentItemName = ''

      if (itemType === 'tool_call') {
        const toolCall = chunk.delta?.toolCall || chunk.toolCall
        this.state.currentItemName = toolCall?.name || 'unknown'
      }

      const itemAddedEvent = this.buildItemAddedEvent(itemType)
      if (itemAddedEvent) {
        results.push(itemAddedEvent)
      }

      // 3. Emit content_part.added immediately after item added (for text/thinking)
      // This is part of the protocol for composite items, but even for simple text it's good practice
      const contentPartEvent = this.buildContentPartAddedEvent(itemType)
      if (contentPartEvent) {
        results.push(contentPartEvent)
      }
    }

    // Capture logprobs if present in current chunk
    const currentLogprobs = chunk.logprobs

    // Update state sequence number if provided in chunk
    if (chunk.sequenceNumber !== undefined) {
      if (chunk.sequenceNumber >= this.state.nextSequenceNumber) {
        this.state.nextSequenceNumber = chunk.sequenceNumber
      }
    }

    // Accumulate content/args
    this.accumulateContent(chunk, itemType)

    // Emit delta/special event
    const results_len = results.length
    const deltaEvent = this.buildDeltaEvent(chunk, itemType, currentLogprobs)
    if (deltaEvent) {
      if (Array.isArray(deltaEvent)) {
        results.push(...deltaEvent)
      } else {
        // If chunk had a sequence number, try to use it for the first event generated
        // (buildDeltaEvent doesn't pass it through directly yet, so we handle it here or in formatEvent)
        // Since formatEvent uses state.nextSequenceNumber if not provided, and we updated state above,
        // it should be fine. BUT if we want to be exact, we should pass it.
        // However, buildDeltaEvent constructs the payload.
        // Let's rely on state.nextSequenceNumber update or pass it in buildDeltaEvent if needed.
        // Actually, if we update state.nextSequenceNumber to chunk.sequenceNumber,
        // then formatEvent will use it and increment.
        // So we need to ensure we set nextSequenceNumber = chunk.sequenceNumber BEFORE generating the event.
        results.push(deltaEvent)
      }
    }

    // Special handling for thinking-end/block_stop that didn't emit via buildDeltaEvent
    if (results.length === results_len) {
      if (
        chunk.type === 'thinking-end' ||
        (chunk.type === 'block_stop' && chunk.blockType === 'thinking')
      ) {
        results.push(
          this.formatEvent('response.reasoning_summary_part.done', {
            type: 'response.reasoning_summary_part.done',
            response_id: this.state.responseId,
            output_index: this.state.currentItemIndex,
          })
        )
      } else if (chunk.type === 'block_stop' && chunk.blockType === 'text') {
        results.push(
          this.formatEvent('response.content_part.done', {
            type: 'response.content_part.done',
            response_id: this.state.responseId,
            output_index: this.state.currentItemIndex,
            item_id: this.state.currentItemId,
            content_index: 0,
          })
        )
      }
    }

    return results
  }

  flush(): string[] {
    return []
  }

  private buildResponseObject(
    status: 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'incomplete'
  ): ResponsesResponse {
    const meta = this.state.metadata || {}

    // Map unified metadata (camelCase) to OpenAI Responses API format (snake_case)
    const response: ResponsesResponse = {
      id: this.state.responseId,
      object: 'response',
      status,
      created_at: this.state.createdAt,
      model: this.state.model,
      // Pass-through fields with snake_case mapping
      instructions: meta.instructions,
      background: meta.background,
      obfuscation: meta.obfuscation,
      temperature: meta.temperature,
      top_p: meta.topP,
      max_output_tokens: meta.maxOutputTokens,
      parallel_tool_calls: meta.parallelToolCalls,
      store: meta.store,
      prompt_cache_key: meta.promptCacheKey,
      top_logprobs: meta.topLogprobs,
      service_tier: meta.serviceTier,
      safety_identifier: meta.safetyIdentifier,
      truncation: meta.truncation,
      reasoning: meta.reasoning,
      text: meta.text,
      tool_choice: meta.toolChoice,
      tools: meta.tools,
      user: meta.user,
      metadata: meta.metadata,
      output: (meta.output as ResponsesResponse['output']) ?? [], // Use upstream output if available, otherwise empty array

      // Map explicit nulls if missing from metadata
      completed_at: meta.completedAt ?? null,
      error: meta.error ?? null,
      incomplete_details: meta.incompleteDetails ?? null,
      max_tool_calls: meta.maxToolCalls ?? null,
      previous_response_id: meta.previousResponseId ?? null,
      prompt_cache_retention: meta.promptCacheRetention ?? null,

      ...(meta.completedAt !== undefined && { completed_at: meta.completedAt }),
      ...(meta.error !== undefined && { error: meta.error }),
      ...(meta.incompleteDetails !== undefined && { incomplete_details: meta.incompleteDetails }),
      ...(meta.maxToolCalls !== undefined && { max_tool_calls: meta.maxToolCalls }),
      ...(meta.previousResponseId !== undefined && {
        previous_response_id: meta.previousResponseId,
      }),
      ...(meta.promptCacheRetention !== undefined && {
        prompt_cache_retention: meta.promptCacheRetention,
      }),
    }

    // Filter out undefined values
    const filteredResponse = Object.fromEntries(
      Object.entries(response).filter(([_, v]) => v !== undefined)
    ) as ResponsesResponse

    if (status === 'completed') {
      filteredResponse.usage = {
        input_tokens: this.state.usage.inputTokens,
        output_tokens: this.state.usage.outputTokens,
        total_tokens: this.state.usage.totalTokens,
      }
    }

    return filteredResponse
  }

  private getItemType(chunk: StreamChunk): 'text' | 'thinking' | 'tool_call' | null {
    // Handle block_stop based on its blockType
    if (chunk.type === 'block_stop') {
      if (chunk.blockType === 'text') return 'text'
      if (chunk.blockType === 'thinking') return 'thinking'
      if (chunk.blockType === 'tool_call') return 'tool_call'
      return null
    }

    if (chunk.type === 'content' || chunk.type === 'text-delta') return 'text'
    if (
      chunk.type === 'thinking' ||
      chunk.type === 'thinking-delta' ||
      chunk.type === 'thinking-start' ||
      chunk.type === 'thinking-end'
    )
      return 'thinking'
    if (chunk.type === 'tool_call' || chunk.type === 'tool-input-delta') return 'tool_call'
    return null
  }

  private accumulateContent(chunk: StreamChunk, type: 'text' | 'thinking' | 'tool_call') {
    if (type === 'text') {
      const text = chunk.delta?.text
      if (text) this.state.currentItemContent.push(text)
    } else if (type === 'thinking') {
      const thinking = chunk.delta?.thinking
      // Handle signature accumulation
      if (typeof thinking === 'object' && thinking !== null) {
        if (thinking.text) this.state.currentItemContent.push(thinking.text)
        if (thinking.signature) this.state.currentItemSignature = thinking.signature
      } else if (typeof thinking === 'string') {
        this.state.currentItemContent.push(thinking)
      }
    } else if (type === 'tool_call') {
      const json = chunk.delta?.partialJson
      if (json) this.state.currentItemArgs += json
    }
  }

  private buildItemAddedEvent(type: 'text' | 'thinking' | 'tool_call'): string | null {
    let item: Record<string, unknown> | null = null

    if (type === 'text') {
      item = {
        type: 'message',
        status: 'in_progress',
        content: [],
        role: 'assistant',
      }
    } else if (type === 'thinking') {
      item = {
        type: 'reasoning',
        summary: [],
      }
    } else if (type === 'tool_call') {
      item = {
        type: 'function_call',
        status: 'in_progress',
        name: this.state.currentItemName,
        call_id: this.state.currentItemId,
        arguments: '', // Streaming args
      }
    }

    if (!item) return null

    return this.formatEvent('response.output_item.added', {
      type: 'response.output_item.added',
      response_id: this.state.responseId,
      output_index: this.state.currentItemIndex,
      item: {
        id: this.state.currentItemId,
        ...item,
      },
    })
  }

  private buildContentPartAddedEvent(type: 'text' | 'thinking' | 'tool_call'): string | null {
    if (type === 'text') {
      return this.formatEvent('response.content_part.added', {
        type: 'response.content_part.added',
        response_id: this.state.responseId,
        output_index: this.state.currentItemIndex,
        item_id: this.state.currentItemId,
        content_index: 0,
        part: {
          type: 'output_text',
          annotations: [],
          logprobs: [],
          text: '',
        },
      })
    }
    if (type === 'thinking') {
      return this.formatEvent('response.reasoning_summary_part.added', {
        type: 'response.reasoning_summary_part.added',
        response_id: this.state.responseId,
        output_index: this.state.currentItemIndex,
        item_id: this.state.currentItemId,
        part: {
          type: 'summary_text',
          text: '',
        },
      })
    }
    return null
  }

  private buildDeltaEvent(
    chunk: StreamChunk,
    type: 'text' | 'thinking' | 'tool_call',
    logprobs?: unknown[]
  ): string | string[] | null {
    const commonFields = {
      ...(chunk.sequenceNumber !== undefined ? { sequence_number: chunk.sequenceNumber } : {}),
      ...(chunk.obfuscation ? { obfuscation: chunk.obfuscation } : {}),
    }

    if (type === 'text') {
      const text = chunk.delta?.text
      if (!text) return null
      return this.formatEvent('response.output_text.delta', {
        type: 'response.output_text.delta',
        response_id: this.state.responseId,
        output_index: this.state.currentItemIndex,
        item_id: this.state.currentItemId,
        content_index: 0,
        delta: text,
        ...(logprobs ? { logprobs } : {}),
        ...commonFields,
      })
    }

    if (type === 'thinking') {
      if (chunk.type === 'thinking-end') {
        const events: string[] = []
        events.push(
          this.formatEvent('response.reasoning_summary_text.done', {
            type: 'response.reasoning_summary_text.done',
            response_id: this.state.responseId,
            output_index: this.state.currentItemIndex,
            item_id: this.state.currentItemId,
            text: '', // Already streamed via deltas
            ...commonFields,
          })
        )
        events.push(
          this.formatEvent('response.reasoning_summary_part.done', {
            type: 'response.reasoning_summary_part.done',
            response_id: this.state.responseId,
            output_index: this.state.currentItemIndex,
            ...commonFields,
          })
        )
        return events
      }

      const thinking = chunk.delta?.thinking
      const thinkingContent = typeof thinking === 'string' ? thinking : thinking?.text

      if (!thinkingContent) return null
      return this.formatEvent('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        response_id: this.state.responseId,
        output_index: this.state.currentItemIndex,
        item_id: this.state.currentItemId,
        summary_index: 0,
        delta: thinkingContent,
        ...(logprobs ? { logprobs } : {}),
        ...commonFields,
      })
    }

    if (type === 'tool_call') {
      const json = chunk.delta?.partialJson
      if (!json) return null
      return this.formatEvent('response.function_call_arguments.delta', {
        type: 'response.function_call_arguments.delta',
        response_id: this.state.responseId,
        output_index: this.state.currentItemIndex,
        item_id: this.state.currentItemId,
        call_id: this.state.currentItemId,
        delta: json,
        ...commonFields,
      })
    }

    return null
  }

  private formatEvent(eventType: string, data: Record<string, unknown>): string {
    let sequence_number = data.sequence_number as number | undefined

    if (sequence_number === undefined) {
      sequence_number = this.state.nextSequenceNumber++
    } else {
      // If we receive an explicit sequence number, update our counter
      // to ensure future auto-generated events follow it
      if (sequence_number >= this.state.nextSequenceNumber) {
        this.state.nextSequenceNumber = sequence_number + 1
      }
    }

    const payload: Record<string, unknown> = {
      ...data,
      sequence_number,
    }

    // Add obfuscation if present in metadata and not explicitly in data
    // Usually obfuscation is per-event or per-object in the new API
    if (this.state.metadata?.obfuscation && payload.obfuscation === undefined) {
      payload.obfuscation = this.state.metadata.obfuscation
    }

    return `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`
  }

  private handleDone(results: string[]): string[] {
    // Ensure we close any open item
    if (this.state.currentItemType) {
      this.finishItem(results)
    }

    const usage = {
      input_tokens: this.state.usage.inputTokens,
      output_tokens: this.state.usage.outputTokens,
      total_tokens: this.state.usage.totalTokens,
      // Map extended usage if available
      ...(this.state.metadata?.usage?.input_tokens_details && {
        input_tokens_details: this.state.metadata.usage.input_tokens_details,
      }),
      ...(this.state.metadata?.usage?.output_tokens_details && {
        output_tokens_details: this.state.metadata.usage.output_tokens_details,
      }),
    }

    // Add reasoning tokens if we tracked them via Unified usage but they weren't in metadata
    // (Unified usage thinkingTokens maps to reasoning_tokens)
    if (this.state.metadata?.usage?.output_tokens_details?.reasoning_tokens === undefined) {
      // If unified usage has thinkingTokens, use it
      // Note: We need to access the unified usage object if possible, but state.usage is simplified.
      // Assuming state.usage might be extended or we just rely on metadata pass-through.
      // For now, let's just use what we have in metadata or basic tokens.
    }

    results.push(
      this.formatEvent('response.completed', {
        type: 'response.completed',
        response: {
          ...this.buildResponseObject('completed'),
          usage,
        },
      })
    )

    return results
  }

  private finishItem(results: string[]) {
    // 1. Emit function_call_arguments.done
    if (this.state.currentItemType === 'tool_call') {
      results.push(
        this.formatEvent('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          response_id: this.state.responseId,
          output_index: this.state.currentItemIndex,
          item_id: this.state.currentItemId,
          call_id: this.state.currentItemId,
          arguments: '', // Already streamed via deltas
        })
      )
    }

    // 2. Emit output_text.done for text/thinking
    if (this.state.currentItemType === 'text') {
      results.push(
        this.formatEvent('response.output_text.done', {
          type: 'response.output_text.done',
          response_id: this.state.responseId,
          output_index: this.state.currentItemIndex,
          item_id: this.state.currentItemId,
          content_index: 0,
          text: '', // Already streamed via deltas
        })
      )
    }

    // 3. Emit response.output_item.done
    let item: ResponsesOutputItem & { signature?: string } = {
      id: this.state.currentItemId,
      type: 'message', // Default, will be overridden
      status: 'completed',
    }

    if (this.state.currentItemType === 'text') {
      item = {
        ...item,
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: '', // Already streamed via deltas
          },
        ],
      }
    } else if (this.state.currentItemType === 'tool_call') {
      item = {
        ...item,
        type: 'function_call',
        name: this.state.currentItemName,
        call_id: this.state.currentItemId,
        arguments: '', // Already streamed via deltas
      }
    } else if (this.state.currentItemType === 'thinking') {
      item = {
        ...item,
        type: 'reasoning',
        summary: [
          {
            type: 'summary_text',
            text: '', // Already streamed via deltas
          },
        ],
      }
      if (this.state.currentItemSignature) {
        item.signature = this.state.currentItemSignature
      }
    }

    results.push(
      this.formatEvent('response.output_item.done', {
        type: 'response.output_item.done',
        response_id: this.state.responseId,
        output_index: this.state.currentItemIndex,
        item: item,
      })
    )
  }

  private handleError(chunk: StreamChunk, results: string[]): string[] {
    const error = chunk.error
      ? typeof chunk.error === 'string'
        ? { message: chunk.error }
        : chunk.error
      : { message: 'Unknown error' }

    // Ensure we emit created/in_progress if not yet done
    if (!this.state.hasEmittedCreated) {
      results.push(
        this.formatEvent('response.created', {
          type: 'response.created',
          response: this.buildResponseObject('in_progress'),
        })
      )
      this.state.hasEmittedCreated = true
    }

    if (!this.state.hasEmittedInProgress) {
      results.push(
        this.formatEvent('response.in_progress', {
          type: 'response.in_progress',
          response: this.buildResponseObject('in_progress'),
        })
      )
      this.state.hasEmittedInProgress = true
    }

    results.push(
      this.formatEvent('response.failed', {
        type: 'response.failed',
        response_id: this.state.responseId,
        error,
      })
    )

    return results
  }
}
