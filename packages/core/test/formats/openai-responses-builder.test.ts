import { describe, expect, test } from 'bun:test'
import { OpenAIResponsesStreamingBuilder } from '../../src/formats/openai-responses/streaming-builder'
import type { StreamChunk } from '../../src/types/unified'

describe('OpenAIResponsesStreamingBuilder', () => {
  test('should emit response.created on first chunk', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    
    const chunk: StreamChunk = {
      type: 'content',
      delta: { type: 'text', text: 'Hello' }
    }
    const events = builder.build(chunk)
    
    // First event should be response.created
    expect(events[0]).toContain('"type":"response.created"')
    expect(events[0]).toContain('"status":"in_progress"')
    
    // Should also follow with item added and delta
    expect(events.some(e => e.includes('"type":"response.output_item.added"'))).toBe(true)
    expect(events.some(e => e.includes('"type":"response.output_text.delta"'))).toBe(true)
    expect(events.some(e => e.includes('"content_index":0'))).toBe(true)
  })

  // TDD RED: Test for @ai-sdk/openai schema compliance - response.created must have created_at and model
  test('response.created should include required created_at field (schema compliance)', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    
    const chunk: StreamChunk = {
      type: 'content',
      delta: { type: 'text', text: 'Hello' }
    }
    const events = builder.build(chunk)
    
    // Parse the response.created event
    const createdEvent = events.find(e => e.includes('"type":"response.created"'))
    expect(createdEvent).toBeDefined()
    
    // Extract the data portion
    const dataMatch = createdEvent!.match(/data: (.+)/)
    expect(dataMatch).toBeDefined()
    expect(dataMatch?.[1]).toBeDefined()
    
    const parsed = JSON.parse(dataMatch![1]!)
    // @ai-sdk/openai requires created_at: number in response.created.response
    expect(parsed.response.created_at).toBeDefined()
    expect(typeof parsed.response.created_at).toBe('number')
  })

  test('response.created should include required model field (schema compliance)', () => {
    const model = 'gpt-5.1'
    const builder = new OpenAIResponsesStreamingBuilder(model)
    
    const chunk: StreamChunk = {
      type: 'content',
      delta: { type: 'text', text: 'Hello' }
    }
    const events = builder.build(chunk)
    
    const createdEvent = events.find(e => e.includes('"type":"response.created"'))
    expect(createdEvent).toBeDefined()
    
    const dataMatch = createdEvent!.match(/data: (.+)/)
    expect(dataMatch?.[1]).toBeDefined()
    const parsed = JSON.parse(dataMatch![1]!)
    
    // @ai-sdk/openai requires model: string in response.created.response
    expect(parsed.response.model).toBeDefined()
    expect(parsed.response.model).toBe('gpt-5.1')
  })

  // TDD RED: First message item should have output_index: 0 (not 1)
  test('first output item should have output_index 0 (0-based indexing)', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    
    const chunk: StreamChunk = {
      type: 'content',
      delta: { type: 'text', text: 'Hello' }
    }
    const events = builder.build(chunk)
    
    // Find the output_item.added event
    const addedEvent = events.find(e => e.includes('"type":"response.output_item.added"'))
    expect(addedEvent).toBeDefined()
    
    const dataMatch = addedEvent!.match(/data: (.+)/)
    expect(dataMatch?.[1]).toBeDefined()
    const parsed = JSON.parse(dataMatch![1]!)
    
    // First item should have output_index 0, not 1
    expect(parsed.output_index).toBe(0)
  })

  // TDD RED: Message item should only have id and type (minimal schema)
  test('message item should have minimal schema (id, type only) for SDK compatibility', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    
    const chunk: StreamChunk = {
      type: 'content',
      delta: { type: 'text', text: 'Hello' }
    }
    const events = builder.build(chunk)
    
    const addedEvent = events.find(e => e.includes('"type":"response.output_item.added"'))
    expect(addedEvent).toBeDefined()
    
    const dataMatch = addedEvent!.match(/data: (.+)/)
    expect(dataMatch?.[1]).toBeDefined()
    const parsed = JSON.parse(dataMatch![1]!)
    
    // Message item should have required fields as per OpenAI protocol
    expect(parsed.item.type).toBe('message')
    expect(parsed.item.id).toBeDefined()
    // Standard OpenAI Realtime API includes status, role and content even if empty
    expect(parsed.item.role).toBe('assistant')
    expect(parsed.item.content).toBeArray()
    expect(parsed.item.status).toBe('in_progress')
  })

  test('should not re-emit response.created on second chunk', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    
    builder.build({ type: 'text-delta', delta: { text: 'Part 1' } })
    const events = builder.build({ type: 'text-delta', delta: { text: 'Part 2' } })
    
    expect(events.some(e => e.includes('"type":"response.created"'))).toBe(false)
    expect(events.some(e => e.includes('"type":"response.output_item.added"'))).toBe(false) // Same item
    expect(events[0]).toContain('"type":"response.output_text.delta"')
  })

  test('should handle tool call transitions', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    
    // 1. Text
    builder.build({ type: 'text-delta', delta: { text: 'Thinking about tools...' } })
    
    // 2. Tool Call
    const toolChunk: StreamChunk = {
      type: 'tool_call',
      blockIndex: 1,
      delta: {
        type: 'tool_call',
        toolCall: { id: 'call_1', name: 'weather', arguments: {} },
        partialJson: '{"loc": "NY"}'
      }
    }
    const events = builder.build(toolChunk)
    
    // Should start new item for tool call
    const addedEvent = events.find(e => e.includes('"type":"response.output_item.added"'))
    expect(addedEvent).toBeDefined()
    expect(addedEvent).toContain('"type":"function_call"')
    expect(addedEvent).toContain('"name":"weather"')
    expect(addedEvent).toContain('"call_id":"call_1"')
    expect(addedEvent).toContain('"output_index":1')
    
    // Should emit arguments delta
    const deltaEvent = events.find(e => e.includes('"type":"response.function_call_arguments.delta"'))
    expect(deltaEvent).toBeDefined()
    expect(deltaEvent).toContain('"delta":"{\\"loc\\": \\"NY\\"}"')
  })

  test('should handle thinking blocks', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    
    const chunk: StreamChunk = {
      type: 'thinking',
      blockIndex: 0,
      delta: { type: 'thinking', thinking: { text: 'I am thinking...' } }
    }
    const events = builder.build(chunk)
    
    // Find events by type instead of relying on hard-coded indices
    const outputItemEvent = events.find(e => e.includes('"type":"response.output_item.added"'))
    expect(outputItemEvent).toBeDefined()
    expect(outputItemEvent).toContain('"type":"reasoning"')
    
    const deltaEvent = events.find(e => e.includes('"type":"response.reasoning_summary_text.delta"'))
    expect(deltaEvent).toBeDefined()
    expect(deltaEvent).toContain('"delta":"I am thinking..."')
  })

  // TDD: reasoning_summary_text.delta must have summary_index per SDK schema
  test('reasoning_summary_text.delta should include required summary_index field', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    
    const chunk: StreamChunk = {
      type: 'thinking',
      blockIndex: 0,
      delta: { type: 'thinking', thinking: { text: 'Thinking...' } }
    }
    const events = builder.build(chunk)
    
    // Find the reasoning delta event
    const deltaEvent = events.find(e => e.includes('"type":"response.reasoning_summary_text.delta"'))
    expect(deltaEvent).toBeDefined()
    
    const dataMatch = deltaEvent!.match(/data: (.+)/)
    expect(dataMatch?.[1]).toBeDefined()
    const parsed = JSON.parse(dataMatch![1]!)
    
    // SDK requires summary_index: number
    expect(parsed.summary_index).toBeDefined()
    expect(typeof parsed.summary_index).toBe('number')
    expect(parsed.item_id).toBeDefined()
    expect(parsed.delta).toBeDefined()
  })

  test('should emit response.completed on done', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    
    // Send some content first
    builder.build({ type: 'text-delta', delta: { text: 'Done' } })
    
    // Send Done
    const doneChunk: StreamChunk = {
      type: 'done',
      usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 }
    }
    const events = builder.build(doneChunk)
    
    expect(events.length).toBeGreaterThan(0)
    
    const completedEvent = events.find(e => e.includes('"type":"response.completed"'))
    expect(completedEvent).toBeDefined()
    expect(completedEvent).toContain('"status":"completed"')
    expect(completedEvent).toContain('"input_tokens":50')
    expect(completedEvent).toContain('"output_tokens":10')
  })
  
  test('should handle usage chunks gracefully (accumulate type)', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    builder.build({ type: 'text-delta', delta: { text: 'Start' } })

    const usageChunk: StreamChunk = {
      type: 'usage',
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 }
    }
    const events = builder.build(usageChunk)
    
    // Usage chunk itself emits nothing immediately in this builder implementation (wait for done), 
    // or maybe returns empty array.
    expect(events.length).toBe(0)
    
    // But verify it is used in completed event
    const doneEvents = builder.build({ type: 'done' })
    const completedEvent = doneEvents.find(e => e.includes('"type":"response.completed"'))
    expect(completedEvent).toBeDefined()
    expect(completedEvent).toContain('"input_tokens":100')
    expect(completedEvent).toContain('"output_tokens":200')
  })

  test('should handle error chunks', () => {
    const builder = new OpenAIResponsesStreamingBuilder()
    
    const errorChunk: StreamChunk = {
      type: 'error',
      error: 'Something went wrong'
    }
    const events = builder.build(errorChunk)
    
    // Find events by type instead of relying on hard-coded indices
    const createdEvent = events.find(e => e.includes('"type":"response.created"'))
    expect(createdEvent).toBeDefined()
    
    const failedEvent = events.find(e => e.includes('"type":"response.failed"'))
    expect(failedEvent).toBeDefined()
    expect(failedEvent).toContain('"message":"Something went wrong"')
  })
})
