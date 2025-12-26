import { describe, expect, it } from 'bun:test'
import { type ChatCompletionChunk, parseSSELine, ResponsesStreamTransformer } from '../streaming'

describe('ResponsesStreamTransformer', () => {
  const createChunk = (overrides: Partial<ChatCompletionChunk> = {}): ChatCompletionChunk => ({
    id: 'chatcmpl-123',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: null,
      },
    ],
    ...overrides,
  })

  describe('first chunk transformation', () => {
    it('should emit response.created, response.output_item.added, and response.content_part.added for first chunk', () => {
      const transformer = new ResponsesStreamTransformer('gpt-4o')
      const chunk = createChunk({
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      })

      const events = transformer.transformChunk(chunk)

      expect(events.length).toBe(3)

      expect(events[0]!.type).toBe('response.created')
      if (events[0]!.type === 'response.created') {
        expect(events[0]!.response.status).toBe('in_progress')
        expect(events[0]!.response.id).toMatch(/^resp_/)
      }

      expect(events[1]!.type).toBe('response.output_item.added')
      if (events[1]!.type === 'response.output_item.added') {
        expect(events[1]!.output_index).toBe(0)
        expect(events[1]!.item.type).toBe('message')
        expect(events[1]!.item.role).toBe('assistant')
        expect(events[1]!.item.status).toBe('in_progress')
      }

      expect(events[2]!.type).toBe('response.content_part.added')
      if (events[2]!.type === 'response.content_part.added') {
        expect(events[2]!.output_index).toBe(0)
        expect(events[2]!.content_index).toBe(0)
        expect(events[2]!.part.type).toBe('output_text')
        expect(events[2]!.part.text).toBe('')
      }
    })

    it('should emit first chunk events even if content comes with role', () => {
      const transformer = new ResponsesStreamTransformer('gpt-4o')
      const chunk = createChunk({
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hi' }, finish_reason: null }],
      })

      const events = transformer.transformChunk(chunk)

      expect(events.length).toBe(4)
      expect(events[0]!.type).toBe('response.created')
      expect(events[1]!.type).toBe('response.output_item.added')
      expect(events[2]!.type).toBe('response.content_part.added')
      expect(events[3]!.type).toBe('response.output_text.delta')
      if (events[3]!.type === 'response.output_text.delta') {
        expect(events[3]!.delta).toBe('Hi')
      }
    })
  })

  describe('content delta transformation', () => {
    it('should emit response.output_text.delta for content chunks', () => {
      const transformer = new ResponsesStreamTransformer('gpt-4o')

      transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        })
      )

      const chunk = createChunk({
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
      })

      const events = transformer.transformChunk(chunk)

      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe('response.output_text.delta')
      if (events[0]!.type === 'response.output_text.delta') {
        expect(events[0]!.output_index).toBe(0)
        expect(events[0]!.content_index).toBe(0)
        expect(events[0]!.delta).toBe('Hello')
      }
    })

    it('should not emit event for empty content delta', () => {
      const transformer = new ResponsesStreamTransformer('gpt-4o')

      transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        })
      )

      const chunk = createChunk({
        choices: [{ index: 0, delta: { content: '' }, finish_reason: null }],
      })

      const events = transformer.transformChunk(chunk)

      expect(events.length).toBe(0)
    })
  })

  describe('finish chunk transformation', () => {
    it('should emit done events when finish_reason is stop', () => {
      const transformer = new ResponsesStreamTransformer('gpt-4o')

      transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        })
      )

      transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: { content: 'Hello World' }, finish_reason: null }],
        })
      )

      const finishChunk = createChunk({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })

      const events = transformer.transformChunk(finishChunk)

      expect(events.length).toBe(3)

      expect(events[0]!.type).toBe('response.output_text.done')
      if (events[0]!.type === 'response.output_text.done') {
        expect(events[0]!.output_index).toBe(0)
        expect(events[0]!.content_index).toBe(0)
        expect(events[0]!.text).toBe('Hello World')
      }

      expect(events[1]!.type).toBe('response.output_item.done')
      if (events[1]!.type === 'response.output_item.done') {
        expect(events[1]!.output_index).toBe(0)
        expect(events[1]!.item.status).toBe('completed')
      }

      expect(events[2]!.type).toBe('response.completed')
      if (events[2]!.type === 'response.completed') {
        expect(events[2]!.response.status).toBe('completed')
      }
    })
  })

  describe('accumulated text tracking', () => {
    it('should correctly accumulate text across multiple deltas', () => {
      const transformer = new ResponsesStreamTransformer('gpt-4o')

      transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        })
      )

      transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
        })
      )

      transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: { content: ' ' }, finish_reason: null }],
        })
      )

      transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: { content: 'World' }, finish_reason: null }],
        })
      )

      const finishEvents = transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })
      )

      const textDoneEvent = finishEvents.find((e) => e.type === 'response.output_text.done')
      expect(textDoneEvent).toBeDefined()
      if (textDoneEvent?.type === 'response.output_text.done') {
        expect(textDoneEvent.text).toBe('Hello World')
      }
    })
  })

  describe('response IDs consistency', () => {
    it('should use consistent response ID across all events', () => {
      const transformer = new ResponsesStreamTransformer('gpt-4o')

      const firstEvents = transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        })
      )

      const finishEvents = transformer.transformChunk(
        createChunk({
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })
      )

      const createdEvent = firstEvents.find((e) => e.type === 'response.created')
      const completedEvent = finishEvents.find((e) => e.type === 'response.completed')

      if (
        createdEvent?.type === 'response.created' &&
        completedEvent?.type === 'response.completed'
      ) {
        expect(createdEvent.response.id).toBe(completedEvent.response.id)
      }
    })
  })

  describe('model in response', () => {
    it('should include model in response events', () => {
      const transformer = new ResponsesStreamTransformer('claude-3-opus')

      const events = transformer.transformChunk(
        createChunk({
          model: 'claude-3-opus',
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        })
      )

      const createdEvent = events.find((e) => e.type === 'response.created')
      if (createdEvent?.type === 'response.created') {
        expect(createdEvent.response.model).toBe('claude-3-opus')
      }
    })
  })
})

describe('parseSSELine', () => {
  it('should parse valid SSE data line', () => {
    const line =
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}'

    const result = parseSSELine(line)

    expect(result).not.toBe(null)
    expect(result).not.toBe('DONE')
    if (result && result !== 'DONE') {
      expect(result.id).toBe('chatcmpl-123')
      expect(result.choices[0]!.delta.content).toBe('Hi')
    }
  })

  it('should return DONE for [DONE] signal', () => {
    const line = 'data: [DONE]'

    const result = parseSSELine(line)

    expect(result).toBe('DONE')
  })

  it('should return null for empty line', () => {
    const result = parseSSELine('')

    expect(result).toBe(null)
  })

  it('should return null for event lines', () => {
    const result = parseSSELine('event: message')

    expect(result).toBe(null)
  })

  it('should return null for comment lines', () => {
    const result = parseSSELine(': keep-alive')

    expect(result).toBe(null)
  })

  it('should handle data line with extra whitespace', () => {
    const line =
      'data:  {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":null}]}'

    const result = parseSSELine(line)

    expect(result).not.toBe(null)
    expect(result).not.toBe('DONE')
    if (result && result !== 'DONE') {
      expect(result.id).toBe('chatcmpl-123')
    }
  })
})
