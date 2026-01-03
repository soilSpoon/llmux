
import { describe, expect, it } from 'bun:test'
import { isEmptyTextBlock } from '../../src/handlers/stream-processor'

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
})
