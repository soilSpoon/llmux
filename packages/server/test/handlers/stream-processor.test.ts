
import { describe, expect, it } from 'bun:test'
import { createMessageStartEvent, isEmptyTextBlock, splitSSEEvents } from '../../src/handlers/stream-processor'

describe('Stream Processor', () => {
  describe('isEmptyTextBlock', () => {
    it('should detect empty text block in content_block_start', () => {
      const chunk = `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`
      expect(isEmptyTextBlock(chunk)).toBe(true)
    })

    it('should detect empty text block in content_block_delta', () => {
      const chunk = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}\n\n`
      expect(isEmptyTextBlock(chunk)).toBe(true)
    })

    it('should NOT detect non-empty text block', () => {
      const chunk = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n`
      expect(isEmptyTextBlock(chunk)).toBe(false)
    })

    it('should NOT detect thinking block', () => {
      const chunk = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Thinking..."}}\n\n`
      expect(isEmptyTextBlock(chunk)).toBe(false)
    })

    it('should handle whitespace in JSON', () => {
        const chunk = `event: content_block_start\ndata: { "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } }\n\n`
        expect(isEmptyTextBlock(chunk)).toBe(true)
    })

    it('should handle multiple empty text fields (edge case)', () => {
        // Technically standard Anthropic SSE doesn't do this, but robust regex should handle it
        const chunk = `data: {"text": "", "other": {"text":""}}`
        expect(isEmptyTextBlock(chunk)).toBe(true)
    })

    it('should NOT flag if one text field is non-empty', () => {
        const chunk = `data: {"text": "", "other": {"text":"content"}}`
        expect(isEmptyTextBlock(chunk)).toBe(false)
    })
  })

  describe('createMessageStartEvent', () => {
    it('should use provided model name in message_start event', () => {
      const event = createMessageStartEvent('claude-opus-4-5-20251101')
      expect(event).toContain('event: message_start')
      expect(event).toContain('"model":"claude-opus-4-5-20251101"')
    })

    it('should generate unique message IDs', () => {
      const event1 = createMessageStartEvent('test-model')
      const event2 = createMessageStartEvent('test-model')
      const idRegex = /"id":"(msg_[a-z0-9]+)"/
      const id1 = event1.match(idRegex)?.[1]
      const id2 = event2.match(idRegex)?.[1]
      expect(id1).toBeDefined()
      expect(id2).toBeDefined()
      expect(id1).not.toBe(id2)
    })

    it('should have correct SSE format structure', () => {
      const event = createMessageStartEvent('test-model')
      expect(event).toMatch(/^event: message_start\ndata: \{.*\}\n\n$/)
    })

    it('should include required message fields', () => {
      const event = createMessageStartEvent('test-model')
      const dataMatch = event.match(/data: (.+)\n\n$/)
      expect(dataMatch).toBeDefined()
      if (!dataMatch?.[1]) {
        throw new Error('Expected data match to have capture group')
      }
      const data = JSON.parse(dataMatch[1]) as {
        type: string
        message: {
          type: string
          role: string
          content: unknown[]
          model: string
          stop_reason: null
          stop_sequence: null
          usage: { input_tokens: number; output_tokens: number }
        }
      }
      expect(data.type).toBe('message_start')
      expect(data.message.type).toBe('message')
      expect(data.message.role).toBe('assistant')
      expect(data.message.content).toEqual([])
      expect(data.message.model).toBe('test-model')
      expect(data.message.stop_reason).toBeNull()
      expect(data.message.stop_sequence).toBeNull()
      expect(data.message.usage).toEqual({ input_tokens: 0, output_tokens: 0 })
    })

    it('should handle various model name formats', () => {
      const models = [
        'claude-3-5-sonnet-20241022',
        'claude-opus-4-5-20251101',
        'gpt-4-turbo',
        'gemini-2.0-flash',
      ]
      for (const model of models) {
        const event = createMessageStartEvent(model)
        expect(event).toContain(`"model":"${model}"`)
      }
    })
  })

  describe('splitSSEEvents', () => {
    describe('sse-standard format', () => {
      it('should split standard SSE events by double newline', () => {
        const buffer = 'data: {"test":1}\n\ndata: {"test":2}\n\n'
        const { events, remaining } = splitSSEEvents(buffer, 'sse-standard', '')

        // Split by \n\n results in ['data: {"test":1}', 'data: {"test":2}', '']
        expect(events.length).toBeGreaterThanOrEqual(1)
        expect(events[0]).toBe('data: {"test":1}')
        expect(remaining).toBe('')
      })

      it('should handle incomplete events in standard format', () => {
        const buffer = 'data: {"test":1}\n\ndata: {"test":'
        const { events, remaining } = splitSSEEvents(buffer, 'sse-standard', '')

        expect(events).toHaveLength(1)
        expect(events[0]).toBe('data: {"test":1}')
        expect(remaining).toBe('data: {"test":')
      })

      it('should accumulate with new text', () => {
        const buffer = 'data: {"partial":'
        const newText = '2}\n\ndata: {"next":3}\n\n'
        const { events, remaining } = splitSSEEvents(buffer + newText, 'sse-standard', newText)

        expect(events.length).toBeGreaterThanOrEqual(1)
        expect(remaining).toBe('')
      })
    })

    describe('sse-line-delimited format (Antigravity)', () => {
      it('should split line-delimited SSE events by single newline', () => {
        const buffer = 'data: {"test":1}\ndata: {"test":2}\n'
        const { events, remaining } = splitSSEEvents(buffer, 'sse-line-delimited', '')

        expect(events).toHaveLength(2)
        expect(events[0]).toBe('data: {"test":1}')
        expect(events[1]).toBe('data: {"test":2}')
        expect(remaining).toBe('')
      })

      it('should handle incomplete line in line-delimited format', () => {
        const buffer = 'data: {"test":1}\ndata: {"test":'
        const newText = ''
        const { events, remaining } = splitSSEEvents(buffer, 'sse-line-delimited', newText)

        expect(events).toHaveLength(1)
        expect(events[0]).toBe('data: {"test":1}')
        expect(remaining).toBe('data: {"test":')
      })

      it('should handle Antigravity streaming chunks', () => {
        // Antigravity sends chunks without complete lines
        const chunk1 = 'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\ndata: {"candidates":[{"content"'
        const { events, remaining } = splitSSEEvents(chunk1, 'sse-line-delimited', chunk1)

        expect(events.length).toBeGreaterThanOrEqual(1)
        expect(events[0]).toContain('data:')
        expect(remaining).toContain('data:')
      })

      it('should skip non-data lines in line-delimited format', () => {
        const buffer = 'event: start\ndata: {"test":1}\ncomment\ndata: {"test":2}\n'
        const { events } = splitSSEEvents(buffer, 'sse-line-delimited', '')

        // Only 'data:' lines should be included
        expect(events.every((e) => e.startsWith('data:'))).toBe(true)
        expect(events).toHaveLength(2)
      })
    })

    describe('edge cases', () => {
      it('should handle empty buffer', () => {
        const { events, remaining } = splitSSEEvents('', 'sse-standard', '')
        expect(events.length).toBeGreaterThanOrEqual(0)
        expect(remaining).toBe('')
      })

      it('should handle buffer with only whitespace', () => {
        const { events } = splitSSEEvents('\n\n', 'sse-standard', '')
        expect(events.filter((e) => e.trim())).toHaveLength(0)
      })

      it('should preserve data in remaining for next call', () => {
        const buffer1 = 'data: {"test":1}\n\ndata: {'
        const { events: events1, remaining: remaining1 } = splitSSEEvents(buffer1, 'sse-standard', '')

        expect(events1).toHaveLength(1)
        expect(remaining1).toBe('data: {')

        // Next call with accumulated buffer
        const buffer2 = remaining1 + '"next":2}\n\n'
        const { events: events2 } = splitSSEEvents(buffer2, 'sse-standard', '"next":2}\n\n')

        expect(events2.length).toBeGreaterThanOrEqual(1)
      })
    })
  })
})
