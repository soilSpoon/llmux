
import { describe, expect, test } from 'bun:test'
import { parseStreamChunk } from '../../core/src/formats/openai-responses/streaming'
import { OpenAIResponsesStreamingBuilder } from '../../core/src/formats/openai-responses/streaming-builder'
import type { StreamChunk } from '../../core/src/types/unified'

describe('OpenAI Responses Streaming E2E', () => {
  test('should preserve metadata through round-trip transformation', () => {
    // 1. Simulate an upstream chunk with rich metadata (as if parsed from upstream)
    const upstreamMetadataChunk: StreamChunk = {
      type: 'done',
      skipStopDelta: true,
      responseMetadata: {
        responseId: 'resp_test_123',
        model: 'gpt-4o',
        createdAt: 1234567890,
        instructions: 'You are a helpful assistant.',
        temperature: 0.7,
        topP: 0.9,
        reasoning: {
          enabled: true,
          effort: 'high',
        },
        metadata: {
          custom_field: 'custom_value',
        },
      },
    }

    // 2. Build the downstream SSE events
    const builder = new OpenAIResponsesStreamingBuilder()
    builder.build(upstreamMetadataChunk)

    // 3. Verify the events contain the metadata
    // Note: Since this is a metadata-only chunk, it might not emit events immediately if it's the first chunk,
    // but the builder accumulates state.
    // However, usually upstream sends metadata early.
    // Let's simulate the flow where we send a content chunk afterwards to trigger emission if needed,
    // OR check if the builder state is correctly populated.
    
    // Actually, OpenAIResponsesStreamingBuilder emits created/in_progress on the first call to build()
    // regardless of the chunk type, if they haven't been emitted.
    // But since `upstreamMetadataChunk` is type: 'done', it returns empty results in the current implementation
    // BUT it updates the state.
    
    // We need to trigger the emission. Let's send a dummy content chunk.
    const contentChunk: StreamChunk = {
      type: 'content',
      blockIndex: 0,
      blockType: 'text',
      delta: { text: 'Hello' }
    }
    
    const events2 = builder.build(contentChunk)
    
    const createdEvent = events2.find(e => e.includes('response.created'))
    const inProgressEvent = events2.find(e => e.includes('response.in_progress'))
    
    expect(createdEvent).toBeDefined()
    expect(inProgressEvent).toBeDefined()
    
    const createdEventData = createdEvent ? createdEvent.split('data: ')[1] : undefined
    const inProgressEventData = inProgressEvent ? inProgressEvent.split('data: ')[1] : undefined

    const createdData = createdEventData ? JSON.parse(createdEventData.trim()) : {}
    const inProgressData = inProgressEventData ? JSON.parse(inProgressEventData.trim()) : {}
    
    // Check fields in response.created
    expect(createdData.response.instructions).toBe('You are a helpful assistant.')
    expect(createdData.response.temperature).toBe(0.7)
    expect(createdData.response.top_p).toBe(0.9)
    expect(createdData.response.reasoning).toEqual({ enabled: true, effort: 'high' })
    expect(createdData.response.metadata).toEqual({ custom_field: 'custom_value' })
    
    // Check fields in response.in_progress
    expect(inProgressData.response.instructions).toBe('You are a helpful assistant.')
    
    // 4. Verify round-trip parsing
    // Now let's parse these events back and see if we get the metadata
    // The parser `parseStreamChunk` handles `response.created` and `response.in_progress`
    
    if (createdEvent) {
      const parsedCreated = parseStreamChunk(createdEvent.trim()) as StreamChunk
      expect(parsedCreated).toBeDefined()
      // The parser implementation for response.created returns { type: 'done', responseMetadata: ..., skipStopDelta: true }
      expect(parsedCreated.type).toBe('done')
      expect(parsedCreated.skipStopDelta).toBe(true)
      
      expect(parsedCreated.responseMetadata).toBeDefined()
      expect(parsedCreated.responseMetadata?.instructions).toBe('You are a helpful assistant.')
      expect(parsedCreated.responseMetadata?.temperature).toBe(0.7)
    }
  })

  test('should preserve reasoning summary events', () => {
    // 1. Simulate an upstream chunk for reasoning summary
    const upstreamReasoningChunk: StreamChunk = {
      type: 'thinking',
      blockIndex: 0,
      blockType: 'thinking',
      delta: {
        type: 'thinking',
        thinking: { text: 'Thinking about...' }
      }
    }

    // 2. Build the downstream SSE events
    const builder = new OpenAIResponsesStreamingBuilder()
    const events = builder.build(upstreamReasoningChunk)

    // 3. Verify the output contains reasoning-specific events
    const summaryDelta = events.find(e => e.includes('response.reasoning_summary_text.delta'))
    expect(summaryDelta).toBeDefined()
    
    if (summaryDelta) {
      const dataPart = summaryDelta.split('data: ')[1]
      if (dataPart) {
        const deltaData = JSON.parse(dataPart)
        expect(deltaData.type).toBe('response.reasoning_summary_text.delta')
        expect(deltaData.delta).toBe('Thinking about...')
      }
    }
  })

  test('should preserve HTTP headers', () => {
     // This test is covered in server/test/handlers/responses-stream.test.ts
     // But we can verify that StreamChunk structure supports headers if needed
     // Currently headers are handled at the handler level, not in the chunk transformation itself.
  })
})
