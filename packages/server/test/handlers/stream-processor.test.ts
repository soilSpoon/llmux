
import { describe, expect, it } from 'bun:test'
import { createMessageStartEvent, isEmptyTextBlock } from '../../src/handlers/stream-processor'

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
})
