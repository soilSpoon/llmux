/**
 * Responses API Streaming Tests
 *
 * Tests for the OpenAI Responses API streaming transformation layer.
 * Covers:
 * 1. SSE event parsing for Responses API
 * 2. Stream transformation from Chat Completions to Responses API
 * 3. Item ID consistency across delta and output_item.added events
 * 4. Full streaming round-trip with Antigravity provider
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  ResponsesStreamTransformer,
  parseSSELine,
  type ChatCompletionChunk,
} from '../src/responses/streaming'
import type {
  ResponsesStreamEvent,
  ResponsesOutputTextDeltaEvent,
  ResponsesOutputItemAddedEvent,
} from '../src/responses/types'

describe('Responses API Streaming', () => {
  describe('parseSSELine', () => {
    it('should parse valid Chat Completions chunk', () => {
      const line = 'data: {"id":"1","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}'
      const result = parseSSELine(line)

      expect(result).not.toBeNull()
      expect(result).not.toBe('DONE')
      const chunk = result as ChatCompletionChunk
      expect(chunk.choices[0]?.delta.content).toBe('Hello')
    })

    it('should parse [DONE] signal', () => {
      const line = 'data: [DONE]'
      const result = parseSSELine(line)

      expect(result).toBe('DONE')
    })

    it('should return null for empty lines', () => {
      expect(parseSSELine('')).toBeNull()
    })

    it('should return null for event directive lines', () => {
      expect(parseSSELine('event: content_block_delta')).toBeNull()
    })

    it('should return null for comment lines', () => {
      expect(parseSSELine(': heartbeat')).toBeNull()
    })

    it('should return null for invalid JSON', () => {
      const line = 'data: {invalid json}'
      const result = parseSSELine(line)

      expect(result).toBeNull()
    })

    it('should handle role delta', () => {
      const line = 'data: {"id":"1","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}'
      const result = parseSSELine(line)

      expect(result).not.toBeNull()
      expect(result).not.toBe('DONE')
      const chunk = result as ChatCompletionChunk
      expect(chunk.choices[0]?.delta.role).toBe('assistant')
    })

    it('should handle finish_reason', () => {
      const line = 'data: {"id":"1","choices":[{"delta":{},"finish_reason":"stop"}]}'
      const result = parseSSELine(line)

      expect(result).not.toBeNull()
      expect(result).not.toBe('DONE')
      const chunk = result as ChatCompletionChunk
      expect(chunk.choices[0]?.finish_reason).toBe('stop')
    })
  })

  describe('ResponsesStreamTransformer', () => {
    let transformer: ResponsesStreamTransformer

    beforeEach(() => {
      transformer = new ResponsesStreamTransformer('gpt-4o')
    })

    it('should generate unique response and message IDs', () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: 'Hi' },
            finish_reason: null,
          },
        ],
      }

      const events = transformer.transformChunk(chunk)

      expect(events.length).toBeGreaterThan(0)

      const createdEvent = events.find((e) => e.type === 'response.created')
      expect(createdEvent).toBeDefined()

      const outputItemEvent = events.find((e) => e.type === 'response.output_item.added') as
        | ResponsesOutputItemAddedEvent
        | undefined
      expect(outputItemEvent).toBeDefined()
      expect(outputItemEvent?.item.id).toMatch(/^msg_/)

      const deltaEvent = events.find((e) => e.type === 'response.output_text.delta') as
        | ResponsesOutputTextDeltaEvent
        | undefined
      expect(deltaEvent).toBeDefined()
      expect(deltaEvent?.item_id).toMatch(/^msg_/)
    })

    it('should include item_id in delta events matching output_item.added', () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: 'Hello' },
            finish_reason: null,
          },
        ],
      }

      const events = transformer.transformChunk(chunk)

      const outputItemEvent = events.find((e) => e.type === 'response.output_item.added') as
        | ResponsesOutputItemAddedEvent
        | undefined
      const deltaEvent = events.find((e) => e.type === 'response.output_text.delta') as
        | ResponsesOutputTextDeltaEvent
        | undefined

      expect(outputItemEvent).toBeDefined()
      expect(deltaEvent).toBeDefined()
      expect(outputItemEvent?.item.id).toBe(deltaEvent?.item_id)
    })

    it('should emit response.created as first event', () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant' },
            finish_reason: null,
          },
        ],
      }

      const events = transformer.transformChunk(chunk)

      expect(events.length).toBeGreaterThan(0)
      expect(events[0]!.type).toBe('response.created')
    })

    it('should accumulate text across multiple chunks', () => {
      const chunk1: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: 'Hello' },
            finish_reason: null,
          },
        ],
      }

      const chunk2: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: ' World' },
            finish_reason: null,
          },
        ],
      }

      const chunk3: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      }

      const events1 = transformer.transformChunk(chunk1)
      const events2 = transformer.transformChunk(chunk2)
      const events3 = transformer.transformChunk(chunk3)

      const deltaEvent1 = events1.find((e) => e.type === 'response.output_text.delta')
      const deltaEvent2 = events2.find((e) => e.type === 'response.output_text.delta')
      const completedEvent = events3.find((e) => e.type === 'response.completed')

      expect(deltaEvent1).toBeDefined()
      expect(deltaEvent2).toBeDefined()
      expect(completedEvent).toBeDefined()

      if (completedEvent && completedEvent.type === 'response.completed') {
        const outputItem = completedEvent.response.output[0]
        expect(outputItem?.content[0]?.text).toBe('Hello World')
      }
    })

    it('should emit all required events on finish_reason', () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: 'Done' },
            finish_reason: 'stop',
          },
        ],
      }

      const events = transformer.transformChunk(chunk)

      const eventTypes = events.map((e) => e.type)
      expect(eventTypes).toContain('response.created')
      expect(eventTypes).toContain('response.output_item.added')
      expect(eventTypes).toContain('response.content_part.added')
      expect(eventTypes).toContain('response.output_text.delta')
      expect(eventTypes).toContain('response.output_text.done')
      expect(eventTypes).toContain('response.output_item.done')
      expect(eventTypes).toContain('response.completed')
    })

    it('should handle completion with correct status', () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: 'Text' },
            finish_reason: 'stop',
          },
        ],
      }

      const events = transformer.transformChunk(chunk)

      const completedEvent = events.find((e) => e.type === 'response.completed')
      if (completedEvent && completedEvent.type === 'response.completed') {
        expect(completedEvent.response.status).toBe('completed')
      }
    })

    it('should not emit delta events for empty content', () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: null,
          },
        ],
      }

      const events = transformer.transformChunk(chunk)

      const deltaEvents = events.filter((e) => e.type === 'response.output_text.delta')
      expect(deltaEvents).toHaveLength(0)
    })

    it('should handle chunks with empty choices array', () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [],
      }

      const events = transformer.transformChunk(chunk)

      expect(events).toHaveLength(0)
    })

    it('should preserve model information', () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: 'Test' },
            finish_reason: 'stop',
          },
        ],
      }

      const events = transformer.transformChunk(chunk)

      const createdEvent = events.find((e) => e.type === 'response.created')
      if (createdEvent && createdEvent.type === 'response.created') {
        expect(createdEvent.response.model).toBe('gpt-4o')
      }

      const completedEvent = events.find((e) => e.type === 'response.completed')
      if (completedEvent && completedEvent.type === 'response.completed') {
        expect(completedEvent.response.model).toBe('gpt-4o')
      }
    })

    it('should set correct output_index and content_index', () => {
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: 'Test' },
            finish_reason: null,
          },
        ],
      }

      const events = transformer.transformChunk(chunk)

      const deltaEvent = events.find((e) => e.type === 'response.output_text.delta') as
        | ResponsesOutputTextDeltaEvent
        | undefined
      expect(deltaEvent?.output_index).toBe(0)
      expect(deltaEvent?.content_index).toBe(0)
    })
  })

  describe('Full Streaming Round-trip', () => {
    it('should transform a complete streaming conversation', () => {
      const transformer = new ResponsesStreamTransformer('gpt-4o')

      const chunks: ChatCompletionChunk[] = [
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: { content: 'The' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: { content: ' answer' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: { content: ' is 42' },
              finish_reason: 'stop',
            },
          ],
        },
      ]

      const allEvents: ResponsesStreamEvent[] = []
      let itemId: string | undefined

      chunks.forEach((chunk) => {
        const events = transformer.transformChunk(chunk)
        allEvents.push(...events)

        // Capture item_id from first output_item.added event
        if (!itemId) {
          const outputItemEvent = events.find((e) => e.type === 'response.output_item.added')
          if (outputItemEvent && outputItemEvent.type === 'response.output_item.added') {
            itemId = outputItemEvent.item.id
          }
        }
      })

      // Verify all delta events have matching item_id
      const deltaEvents = allEvents.filter((e) => e.type === 'response.output_text.delta')
      deltaEvents.forEach((event) => {
        if (event.type === 'response.output_text.delta') {
          expect(event.item_id).toBe(itemId)
        }
      })

      // Verify final completion
      const completedEvent = allEvents.find((e) => e.type === 'response.completed')
      expect(completedEvent).toBeDefined()
      if (completedEvent && completedEvent.type === 'response.completed') {
        expect(completedEvent.response.status).toBe('completed')
        expect(completedEvent.response.output[0]?.content[0]?.text).toBe('The answer is 42')
      }

      // Verify event sequence
      const eventTypes = allEvents.map((e) => e.type)
      const createdIndex = eventTypes.indexOf('response.created')
      const outputItemIndex = eventTypes.indexOf('response.output_item.added')
      const contentPartIndex = eventTypes.indexOf('response.content_part.added')
      const firstDeltaIndex = eventTypes.indexOf('response.output_text.delta')
      const completedIndex = eventTypes.indexOf('response.completed')

      expect(createdIndex).toBe(0)
      expect(outputItemIndex).toBeGreaterThan(createdIndex)
      expect(contentPartIndex).toBeGreaterThan(outputItemIndex)
      expect(firstDeltaIndex).toBeGreaterThan(contentPartIndex)
      expect(completedIndex).toBeGreaterThan(firstDeltaIndex)
    })
  })

  describe('Error Handling', () => {
    it('should handle chunks with null choices gracefully', () => {
      const transformer = new ResponsesStreamTransformer('gpt-4o')
      const chunk: ChatCompletionChunk = {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [null as any],
      }

      const events = transformer.transformChunk(chunk)
      expect(events).toHaveLength(0)
    })

    it('should handle rapid sequential chunks', () => {
      const transformer = new ResponsesStreamTransformer('gpt-4o')
      const chunks: ChatCompletionChunk[] = Array.from({ length: 100 }, (_, i) => ({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: String(i) },
            finish_reason: i === 99 ? 'stop' : null,
          },
        ],
      }))

      const allEvents: ResponsesStreamEvent[] = []
      chunks.forEach((chunk) => {
        const events = transformer.transformChunk(chunk)
        allEvents.push(...events)
      })

      const completedEvent = allEvents.find((e) => e.type === 'response.completed')
      expect(completedEvent).toBeDefined()

      const deltaCount = allEvents.filter((e) => e.type === 'response.output_text.delta').length
      expect(deltaCount).toBe(100)
    })
  })
})
