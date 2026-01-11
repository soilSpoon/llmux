/**
 * OpenAI Responses Streaming Builder Tests
 *
 * Tests for the OpenAIResponsesStreamingBuilder class which converts unified
 * StreamChunks into OpenAI Responses API SSE events.
 *
 * Focus: Ensuring correct event sequence as per OpenAI Responses API protocol:
 * response.created -> response.in_progress -> response.output_item.added -> deltas -> response.completed
 */

import { describe, it, expect } from 'bun:test'
import { OpenAIResponsesStreamingBuilder } from '../../src/formats/openai-responses/streaming-builder'
import type { StreamChunk } from '../../src/types/unified'

/**
 * Helper to parse SSE events from the formatted string output
 */
function parseSSEEvents(output: string[]): Array<{ event: string; data: unknown }> {
  return output.map((chunk) => {
    const lines = chunk.trim().split('\n')
    const eventLine = lines.find((l) => l.startsWith('event:'))
    const dataLine = lines.find((l) => l.startsWith('data:'))

    return {
      event: eventLine?.replace('event: ', '') ?? '',
      data: dataLine ? JSON.parse(dataLine.replace('data: ', '')) : null,
    }
  })
}

describe('OpenAIResponsesStreamingBuilder', () => {
  describe('Metadata Event Output', () => {
    it('should include sequence_number and obfuscation in event body if present in chunk', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Sensitive Data' },
        // Simulate extended metadata fields on the chunk itself (or passed through some mechanism)
        // Currently StreamChunk doesn't have sequenceNumber/obfuscation on the root, 
        // but we might be expecting them to be passed through responseMetadata or similar?
        // Let's check how the requirement is phrased: 
        // "StreamChunk에 sequenceNumber, obfuscation 등이 포함되었을 때 StreamingBuilder가 생성하는 SSE 이벤트에 해당 필드들이 포함되는지 검증"
        // 
        // Based on types, obfuscation is in responseMetadata. sequence_number is in ResponsesStreamEvent.
        // If the task implies that *every* event should have these if they are relevant, 
        // or if specific events need them. 
        // Let's assume responseMetadata carries obfuscation, and we want to see it in the response object
        // AND potentially sequence_number if we implement it.
        //
        // However, looking at the ResponsesStreamEvent definition in types.ts:
        // interface ResponsesStreamEvent { ... sequence_number?: number; obfuscation?: boolean; ... }
        //
        // So these can be top-level fields in the SSE event JSON, not just inside 'response'.
        
        responseMetadata: {
          obfuscation: true,
          // sequenceNumber is not in ResponseMetadata, it might need to be tracked by the builder or passed in chunk
        }
      } as StreamChunk & { sequenceNumber?: number, obfuscation?: boolean }
      
      // Let's manually inject properties if they are not standard StreamChunk yet, 
      // or assume the test is driving the implementation of these fields in StreamChunk.
      // For this test, I'll add them to the chunk object cast as any or extended type 
      // to simulate the input that drives the requirement.
      ;(chunk as any).sequenceNumber = 42
      ;(chunk as any).obfuscation = true

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)
      
      // We expect at least one event (e.g., output_text.delta) to carry these top-level fields
      // or specifically the response.created/in_progress events?
      // Usually sequence_number increments per event. 
      // If the input chunk has a sequence number, maybe we should use it?
      // Or maybe the builder generates it?
      // The task says: "StreamChunk에 sequenceNumber ... 포함되었을 때 ... 생성하는 SSE 이벤트에 해당 필드들이 포함되는지"
      // So if input has it, output event should have it.
      
      const deltaEvent = events.find(e => e.event === 'response.output_text.delta')
      expect(deltaEvent).toBeDefined()
      
      // Check for top-level fields in the data object
      const data = deltaEvent?.data as any
      expect(data.sequence_number).toBe(42)
      expect(data.obfuscation).toBe(true)
    })
  })

  describe('Protocol Event Sequence (Extended)', () => {
    it('should emit response.content_part.added before deltas', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: {
          type: 'text',
          text: 'Hello',
        },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      // Expected sequence: created -> in_progress -> output_item.added -> content_part.added -> delta
      const contentPartEvent = events.find(e => e.event === 'response.content_part.added')
      
      expect(contentPartEvent).toBeDefined()
      expect(contentPartEvent?.data).toMatchObject({
        type: 'response.content_part.added',
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text' }
      })
    })

    it('should include signature in output_item.done for thinking items', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      // Thinking with signature (accumulated or final chunk)
      const chunk: StreamChunk = {
        type: 'thinking',
        blockIndex: 0,
        delta: { thinking: { text: 'Thought', signature: 'sig_123' } }
      }

      builder.build(chunk)
      const output = builder.build({ type: 'done' }) // Finish item
      const events = parseSSEEvents(output)

      const itemDoneEvent = events.find(e => e.event === 'response.output_item.done')
      
      expect(itemDoneEvent).toBeDefined()
      // Signature should be in the item object (extension to protocol but needed for Gemini)
      // or somewhere accessible.
      expect(itemDoneEvent?.data).toMatchObject({
        type: 'response.output_item.done',
        item: {
          type: 'reasoning', // or message
          signature: 'sig_123'
        }
      })
    })

    it('should emit response.output_item.done when item is completed', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      // Start item
      builder.build({
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' }
      })

      // Finish item (new block starts or stream ends)
      // Simulating stream end for this item by sending done chunk
      const output = builder.build({ type: 'done' })
      const events = parseSSEEvents(output)

      const itemDoneEvent = events.find(e => e.event === 'response.output_item.done')
      
      expect(itemDoneEvent).toBeDefined()
      expect(itemDoneEvent?.data).toMatchObject({
        type: 'response.output_item.done',
        output_index: 0,
        item: { status: 'completed' }
      })
    })

    it('should emit response.function_call_arguments.done for tool calls', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      // Tool call start
      builder.build({
        type: 'tool_call',
        blockIndex: 0,
        toolCall: { id: 'call_1', name: 'test' },
        delta: { partialJson: '{"a":1}' }
      })

      // Tool call end (simulated by switching block or done)
      const output = builder.build({ type: 'done' }) 
      const events = parseSSEEvents(output)

      const argsDoneEvent = events.find(e => e.event === 'response.function_call_arguments.done')
      
      expect(argsDoneEvent).toBeDefined()
      expect(argsDoneEvent?.data).toMatchObject({
        type: 'response.function_call_arguments.done',
        output_index: 0,
      })
    })
  })

  // Existing tests follow...
  describe('Protocol Event Sequence', () => {
    it('should emit response.in_progress after response.created on first chunk', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'thinking',
        blockIndex: 0,
        blockType: 'thinking',
        delta: {
          type: 'thinking',
          thinking: { text: '**Exploring options**' },
        },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      // Verify event sequence: response.created -> response.in_progress -> ...
      expect(events.length).toBeGreaterThanOrEqual(3)
      expect(events[0]?.event).toBe('response.created')
      expect(events[1]?.event).toBe('response.in_progress')
      expect(events[2]?.event).toBe('response.output_item.added')
    })

    it('should only emit response.created and response.in_progress once', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk1: StreamChunk = {
        type: 'thinking',
        blockIndex: 0,
        blockType: 'thinking',
        delta: {
          type: 'thinking',
          thinking: { text: '**First thought**' },
        },
      }

      const chunk2: StreamChunk = {
        type: 'thinking',
        blockIndex: 0,
        blockType: 'thinking',
        delta: {
          type: 'thinking',
          thinking: { text: '**Second thought**' },
        },
      }

      // First chunk should emit response.created and response.in_progress
      const output1 = builder.build(chunk1)
      const events1 = parseSSEEvents(output1)
      const createdEvents1 = events1.filter((e) => e.event === 'response.created')
      const inProgressEvents1 = events1.filter((e) => e.event === 'response.in_progress')
      expect(createdEvents1.length).toBe(1)
      expect(inProgressEvents1.length).toBe(1)

      // Second chunk should NOT emit these events again
      const output2 = builder.build(chunk2)
      const events2 = parseSSEEvents(output2)
      const createdEvents2 = events2.filter((e) => e.event === 'response.created')
      const inProgressEvents2 = events2.filter((e) => e.event === 'response.in_progress')
      expect(createdEvents2.length).toBe(0)
      expect(inProgressEvents2.length).toBe(0)
    })

    it('should include same response object in response.in_progress as in response.created', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: {
          type: 'text',
          text: 'Hello',
        },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      const createdEvent = events.find((e) => e.event === 'response.created')
      const inProgressEvent = events.find((e) => e.event === 'response.in_progress')

      expect(createdEvent).toBeDefined()
      expect(inProgressEvent).toBeDefined()

      // Both should have matching response IDs
      const createdData = createdEvent?.data as { response?: { id: string } }
      const inProgressData = inProgressEvent?.data as { response?: { id: string } }

      expect(createdData?.response?.id).toBe(inProgressData?.response?.id)
    })

    it('should emit correct full event sequence for a complete thinking+text response', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      // Thinking chunk
      const thinkingChunk: StreamChunk = {
        type: 'thinking',
        blockIndex: 0,
        blockType: 'thinking',
        delta: {
          type: 'thinking',
          thinking: { text: '**Analyzing**' },
        },
      }

      // Text chunk (different block)
      const textChunk: StreamChunk = {
        type: 'content',
        blockIndex: 1,
        blockType: 'text',
        delta: {
          type: 'text',
          text: 'The answer is 42.',
        },
      }

      // Done chunk
      const doneChunk: StreamChunk = {
        type: 'done',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      }

      const output1 = builder.build(thinkingChunk)
      const output2 = builder.build(textChunk)
      const output3 = builder.build(doneChunk)

      const allEvents = parseSSEEvents([...output1, ...output2, ...output3])
      const eventTypes = allEvents.map((e) => e.event)

      // Verify key events are present in order
      const createdIdx = eventTypes.indexOf('response.created')
      const inProgressIdx = eventTypes.indexOf('response.in_progress')
      const firstOutputItemIdx = eventTypes.indexOf('response.output_item.added')
      const completedIdx = eventTypes.indexOf('response.completed')

      expect(createdIdx).toBe(0) // First event
      expect(inProgressIdx).toBe(1) // Second event (immediately after created)
      expect(firstOutputItemIdx).toBeGreaterThan(inProgressIdx)
      expect(completedIdx).toBeGreaterThan(firstOutputItemIdx)
    })
  })

  describe('Event Data Validation', () => {
    it('response.created should include null fields matching OpenAI spec', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      // First, provide metadata with explicit null values (simulating upstream response)
      const metadataChunk: StreamChunk = {
        type: 'done',
        skipStopDelta: true,
        responseMetadata: {
          responseId: 'resp_test',
          model: 'gpt-5.1',
          createdAt: 1234567890,
          status: 'in_progress',
          completedAt: null as unknown as number,
          error: null,
          incompleteDetails: null,
          maxToolCalls: null as unknown as number,
          output: [],
          previousResponseId: null as unknown as string,
          promptCacheRetention: null as unknown as number,
        },
      }
      builder.build(metadataChunk)

      // Then send a content chunk to trigger response.created emission
      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: {
          type: 'text',
          text: 'Hello',
        },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)
      const createdEvent = events.find((e) => e.event === 'response.created')

      expect(createdEvent).toBeDefined()

      const data = createdEvent?.data as {
        type: string
        response: Record<string, unknown>
      }

      expect(data.type).toBe('response.created')
      expect(data.response).toBeDefined()

      // These fields MUST be present with null values per OpenAI Responses API spec
      expect(data.response).toHaveProperty('completed_at', null)
      expect(data.response).toHaveProperty('error', null)
      expect(data.response).toHaveProperty('incomplete_details', null)
      expect(data.response).toHaveProperty('max_tool_calls', null)
      expect(data.response).toHaveProperty('output', [])
      expect(data.response).toHaveProperty('previous_response_id', null)
      expect(data.response).toHaveProperty('prompt_cache_retention', null)
    })

    it('response.in_progress should have correct structure', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: {
          type: 'text',
          text: 'Test',
        },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)
      const inProgressEvent = events.find((e) => e.event === 'response.in_progress')

      expect(inProgressEvent).toBeDefined()

      const data = inProgressEvent?.data as {
        type: string
        response: {
          id: string
          object: string
          status: string
        }
      }

      expect(data.type).toBe('response.in_progress')
      expect(data.response).toBeDefined()
      expect(data.response.id).toMatch(/^resp_/)
      expect(data.response.object).toBe('response')
      expect(data.response.status).toBe('in_progress')
    })
  })

  describe('Metadata Preservation', () => {
    it('should extract metadata from response.created chunk and preserve it through stream', () => {
      const builder = new OpenAIResponsesStreamingBuilder()
      
      // Simulate response.created event with full metadata
      const metadataChunk: StreamChunk = {
        type: 'done',
        responseMetadata: {
          responseId: 'resp_metadata_12345',
          model: 'gpt-4o-realtime',
          createdAt: 1704067200,
          instructions: 'You are a helpful assistant.',
          temperature: 0.7,
          topP: 0.95,
          maxOutputTokens: 2048,
          parallelToolCalls: true,
          store: true,
          obfuscation: false,
        },
        skipStopDelta: true,
      }
      
      // First, pass metadata chunk
      const output1 = builder.build(metadataChunk)
      expect(output1).toEqual([]) // Metadata-only chunks return empty
      
      // Now build a content chunk - should use the metadata
      const contentChunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' }
      }
      
      const output2 = builder.build(contentChunk)
      const events = parseSSEEvents(output2)
      
      const createdEvent = events.find(e => e.event === 'response.created')
      expect(createdEvent?.data).toMatchObject({
        response: {
          id: 'resp_metadata_12345',
          model: 'gpt-4o-realtime',
          created_at: 1704067200,
          status: 'in_progress',
        }
      })
    })

    it('should use original response ID and model when set', () => {
      const originalId = 'resp_original_12345'
      const originalModel = 'gpt-5.1-2025-11-13'
      const builder = new OpenAIResponsesStreamingBuilder()
      builder.setOriginalResponseId(originalId, originalModel)

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' }
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)
      
      const createdEvent = events.find(e => e.event === 'response.created')
      expect(createdEvent?.data).toMatchObject({
        response: {
          id: originalId,
          model: originalModel
        }
      })
    })

    it('should fallback to synthetic ID and provided model if setOriginalResponseId is not called', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')
      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' }
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)
      
      const createdEvent = events.find(e => e.event === 'response.created')
      const data = createdEvent?.data as any
      expect(data.response.id).toMatch(/^resp_/)
      expect(data.response.model).toBe('gpt-5.1')
    })

    it('should preserve item IDs from StreamChunk.id', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')
      const itemId = 'msg_original_999'

      const chunk: StreamChunk = {
        type: 'content',
        id: itemId,
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' }
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)
      
      const addedEvent = events.find(e => e.event === 'response.output_item.added')
      expect(addedEvent?.data).toMatchObject({
        item: {
          id: itemId
        }
      })
    })

    it('should omit optional fields (top_p, top_logprobs, truncation) when not present in metadata', () => {
      const builder = new OpenAIResponsesStreamingBuilder()
      
      const metadataChunk: StreamChunk = {
        type: 'done',
        responseMetadata: {
          responseId: 'resp_missing_opts',
          model: 'gpt-4o',
          createdAt: 1704067200,
          // Explicitly omitting optional fields
        },
        skipStopDelta: true,
      }
      
      builder.build(metadataChunk)
      
      const contentChunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Start' }
      }
      
      const output = builder.build(contentChunk)
      const events = parseSSEEvents(output)
      
      const createdEvent = events.find(e => e.event === 'response.created')
      const response = (createdEvent?.data as any).response
      
      expect(response).toBeDefined()
      expect(response).not.toHaveProperty('top_p')
      expect(response).not.toHaveProperty('top_logprobs')
      expect(response).not.toHaveProperty('truncation')
    })
  })

  describe('Response Object Structure', () => {
    it('should include all required null fields in response.created', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: {
          type: 'text',
          text: 'Hello',
        },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      const createdEvent = events.find((e) => e.event === 'response.created')
      const response = (createdEvent?.data as any).response

      expect(response).toBeDefined()
      
      // Verify null fields presence
      expect(response.completed_at).toBeNull()
      expect(response.error).toBeNull()
      expect(response.incomplete_details).toBeNull()
      // expect(response.max_tool_calls).toBeNull() // Not checking this one as it might be optional or provider specific? 
      // Re-reading task description: "max_tool_calls: null" IS required.
      expect(response.max_tool_calls).toBeNull()
      expect(response.output).toEqual([])
      expect(response.previous_response_id).toBeNull()
      expect(response.prompt_cache_retention).toBeNull()
    })
  })

  describe('Special Chunk Types', () => {
    it('should handle thinking-start chunk', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')
      const output = builder.build({
        type: 'thinking-start',
        blockIndex: 0,
        blockType: 'thinking'
      })
      const events = parseSSEEvents(output)
      
      const addedEvent = events.find(e => e.event === 'response.reasoning_summary_part.added')
      expect(addedEvent).toBeDefined()
      expect(addedEvent?.data).toMatchObject({
        type: 'response.reasoning_summary_part.added',
        output_index: 0
      })
    })

    it('should handle thinking-end chunk', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')
      // Start thinking first to avoid unexpected auto-opens
      builder.build({ type: 'thinking-start', blockIndex: 0, blockType: 'thinking' })
      
      const output = builder.build({
        type: 'thinking-end',
        blockIndex: 0,
        blockType: 'thinking',
        delta: { thinking: { text: 'Thought done' } }
      })
      const events = parseSSEEvents(output)
      
      const textDoneEvent = events.find(e => e.event === 'response.reasoning_summary_text.done')
      const partDoneEvent = events.find(e => e.event === 'response.reasoning_summary_part.done')
      
      expect(textDoneEvent).toBeDefined()
      expect(textDoneEvent?.data).toMatchObject({
        type: 'response.reasoning_summary_text.done',
        text: '' // Already streamed via deltas
      })
      expect(partDoneEvent).toBeDefined()
      expect(partDoneEvent?.data).toMatchObject({
        type: 'response.reasoning_summary_part.done'
      })
    })

    it('should handle block_stop chunk for text', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')
      builder.build({ type: 'content', blockIndex: 0, blockType: 'text', delta: { type: 'text', text: 'Hi' } })

      const output = builder.build({
        type: 'block_stop',
        blockIndex: 0,
        blockType: 'text'
      })
      const events = parseSSEEvents(output)
      
      const partDoneEvent = events.find(e => e.event === 'response.content_part.done')
      expect(partDoneEvent).toBeDefined()
      expect(partDoneEvent?.data).toMatchObject({
        type: 'response.content_part.done'
      })
    })

    it('should emit response.completed on done', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')
      const output = builder.build({ type: 'done' })
      const events = parseSSEEvents(output)
      
      const completedEvent = events.find(e => e.event === 'response.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.data).toMatchObject({
        type: 'response.completed',
        response: {
          status: 'completed'
        }
      })
    })
  })
})
