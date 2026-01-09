/**
 * OpenAI Responses Item Fields Tests
 *
 * TDD: Verify that response.output_item.added events include all required
 * fields to prevent client-side "Cannot read properties of undefined (reading 'push')" errors.
 *
 * Problem: Upstream OpenAI sends items with empty arrays for content, summary, etc.
 * Our transformation was dropping these fields, causing client push() calls to fail on undefined.
 */

import { describe, it, expect } from 'bun:test'
import { OpenAIResponsesStreamingBuilder } from '../../src/formats/openai-responses/streaming-builder'
import type { StreamChunk } from '../../src/types/unified'

function parseSSEEvents(output: string[]): Array<{ event: string; data: Record<string, unknown> }> {
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

describe('OpenAI Responses Item Fields (Push Error Prevention)', () => {
  describe('response.output_item.added for message type', () => {
    it('should include content array (empty) in item', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      const itemAddedEvent = events.find((e) => e.event === 'response.output_item.added')
      expect(itemAddedEvent).toBeDefined()

      const item = itemAddedEvent?.data.item as Record<string, unknown>
      expect(item.type).toBe('message')
      expect(item.content).toBeArray()
      expect(item.content).toEqual([])
    })

    it('should include role field in message item', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      const itemAddedEvent = events.find((e) => e.event === 'response.output_item.added')
      const item = itemAddedEvent?.data.item as Record<string, unknown>

      expect(item.role).toBe('assistant')
    })

    it('should include status field in message item', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      const itemAddedEvent = events.find((e) => e.event === 'response.output_item.added')
      const item = itemAddedEvent?.data.item as Record<string, unknown>

      expect(item.status).toBe('in_progress')
    })
  })

  describe('response.output_item.added for reasoning type', () => {
    it('should include summary array (empty) in item', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'thinking',
        blockIndex: 0,
        blockType: 'thinking',
        delta: { type: 'thinking', thinking: { text: 'Thinking...' } },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      const itemAddedEvent = events.find((e) => e.event === 'response.output_item.added')
      expect(itemAddedEvent).toBeDefined()

      const item = itemAddedEvent?.data.item as Record<string, unknown>
      expect(item.type).toBe('reasoning')
      expect(item.summary).toBeArray()
      expect(item.summary).toEqual([])
    })
  })

  describe('response.content_part.added', () => {
    it('should include annotations array (empty) in part', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      const contentPartEvent = events.find((e) => e.event === 'response.content_part.added')
      expect(contentPartEvent).toBeDefined()

      const part = contentPartEvent?.data.part as Record<string, unknown>
      expect(part.annotations).toBeArray()
      expect(part.annotations).toEqual([])
    })

    it('should include logprobs array (empty) in part', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      const contentPartEvent = events.find((e) => e.event === 'response.content_part.added')
      const part = contentPartEvent?.data.part as Record<string, unknown>

      expect(part.logprobs).toBeArray()
      expect(part.logprobs).toEqual([])
    })
  })

  describe('Upstream compatibility (from compare analysis)', () => {
    it('message item should match upstream structure exactly', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      const itemAddedEvent = events.find((e) => e.event === 'response.output_item.added')
      const item = itemAddedEvent?.data.item as Record<string, unknown>

      // Based on upstream analysis, message items should have these fields:
      // ['id', 'type', 'status', 'content', 'role']
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('type', 'message')
      expect(item).toHaveProperty('status', 'in_progress')
      expect(item).toHaveProperty('content')
      expect(item).toHaveProperty('role', 'assistant')
    })

    it('content part should match upstream structure', () => {
      const builder = new OpenAIResponsesStreamingBuilder('gpt-5.1')

      const chunk: StreamChunk = {
        type: 'content',
        blockIndex: 0,
        blockType: 'text',
        delta: { type: 'text', text: 'Hello' },
      }

      const output = builder.build(chunk)
      const events = parseSSEEvents(output)

      const contentPartEvent = events.find((e) => e.event === 'response.content_part.added')
      const part = contentPartEvent?.data.part as Record<string, unknown>

      // Based on upstream: part keys ['type', 'annotations', 'logprobs', 'text']
      expect(part).toHaveProperty('type', 'output_text')
      expect(part).toHaveProperty('annotations')
      expect(part).toHaveProperty('logprobs')
      expect(part).toHaveProperty('text', '')
    })
  })
})
