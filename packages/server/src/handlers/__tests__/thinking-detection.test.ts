import { describe, expect, it } from 'bun:test'
import { isThinkingPart, isThinkingBlock } from '../thinking-utils'
import type { ThinkingPart, ThinkingBlock } from '../types/thinking-types'

describe('isThinkingPart', () => {
  describe('positive cases', () => {
    it('should detect Gemini signed thinking (thought: true)', () => {
      const part: ThinkingPart = { thought: true, text: 'internal reasoning' }
      expect(isThinkingPart(part)).toBe(true)
    })

    it('should detect Anthropic thinking (type: thinking)', () => {
      const part: ThinkingPart = { type: 'thinking', text: 'Let me think...' }
      expect(isThinkingPart(part)).toBe(true)
    })

    it('should detect OpenAI reasoning (type: reasoning)', () => {
      const part: ThinkingPart = { type: 'reasoning', text: 'Reasoning content' }
      expect(isThinkingPart(part)).toBe(true)
    })

    it('should detect redacted thinking (type: redacted_thinking)', () => {
      const part: ThinkingPart = { type: 'redacted_thinking' }
      expect(isThinkingPart(part)).toBe(true)
    })

    it('should detect inline thinking content (thinking: string)', () => {
      const part: ThinkingPart = { thinking: 'some string' }
      expect(isThinkingPart(part)).toBe(true)
    })

    it('should detect thinking with signature', () => {
      const part: ThinkingPart = {
        thought: true,
        text: 'reasoning',
        thoughtSignature: 'sig123',
      }
      expect(isThinkingPart(part)).toBe(true)
    })
  })

  describe('negative cases', () => {
    it('should not detect regular text parts', () => {
      const part: ThinkingPart = { text: 'Hello, world!' }
      expect(isThinkingPart(part)).toBe(false)
    })

    it('should not detect function calls', () => {
      const part: ThinkingPart = {
        functionCall: { name: 'get_weather', args: {} },
      }
      expect(isThinkingPart(part)).toBe(false)
    })

    it('should not detect function responses', () => {
      const part: ThinkingPart = {
        functionResponse: { name: 'get_weather', response: {} },
      }
      expect(isThinkingPart(part)).toBe(false)
    })

    it('should not detect tool_use parts', () => {
      const part: ThinkingPart = {
        tool_use: { id: 'tool1', name: 'search' },
      }
      expect(isThinkingPart(part)).toBe(false)
    })

    it('should not detect parts with type: text', () => {
      const part: ThinkingPart = { type: 'text', text: 'regular content' }
      expect(isThinkingPart(part)).toBe(false)
    })

    it('should not detect parts with thought: false', () => {
      const part: ThinkingPart = { thought: false, text: 'not thinking' }
      expect(isThinkingPart(part)).toBe(false)
    })

    it('should not detect parts with thinking: undefined', () => {
      const part: ThinkingPart = { text: 'content', thinking: undefined }
      expect(isThinkingPart(part)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle empty object', () => {
      const part: ThinkingPart = {}
      expect(isThinkingPart(part)).toBe(false)
    })

    it('should handle parts with multiple indicators (thought + type)', () => {
      const part: ThinkingPart = { thought: true, type: 'thinking' }
      expect(isThinkingPart(part)).toBe(true)
    })

    it('should handle parts with mixed indicators (thinking + thought)', () => {
      const part: ThinkingPart = { thinking: 'content', thought: true }
      expect(isThinkingPart(part)).toBe(true)
    })

    it('should not detect numeric thinking field', () => {
      const part = { thinking: 123 } as unknown as ThinkingPart
      expect(isThinkingPart(part)).toBe(false)
    })

    it('should not detect object thinking field', () => {
      const part = { thinking: { nested: 'value' } } as unknown as ThinkingPart
      expect(isThinkingPart(part)).toBe(false)
    })

    it('should detect empty string thinking field', () => {
      const part: ThinkingPart = { thinking: '' }
      expect(isThinkingPart(part)).toBe(true)
    })

    it('should handle parts with unknown type values', () => {
      const part: ThinkingPart = { type: 'custom_type' }
      expect(isThinkingPart(part)).toBe(false)
    })
  })
})

describe('isThinkingBlock', () => {
  describe('positive cases', () => {
    it('should detect thinking blocks (type: thinking)', () => {
      const block: ThinkingBlock = { type: 'thinking', text: 'Thinking...' }
      expect(isThinkingBlock(block)).toBe(true)
    })

    it('should detect redacted thinking blocks (type: redacted_thinking)', () => {
      const block: ThinkingBlock = { type: 'redacted_thinking' }
      expect(isThinkingBlock(block)).toBe(true)
    })

    it('should detect inline thinking content (thinking: string)', () => {
      const block: ThinkingBlock = { thinking: 'some reasoning' }
      expect(isThinkingBlock(block)).toBe(true)
    })

    it('should detect thinking block with signature', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        text: 'content',
        signature: 'sig456',
      }
      expect(isThinkingBlock(block)).toBe(true)
    })
  })

  describe('negative cases', () => {
    it('should not detect text blocks (type: text)', () => {
      const block: ThinkingBlock = { type: 'text', text: 'Regular content' }
      expect(isThinkingBlock(block)).toBe(false)
    })

    it('should not detect tool_use blocks', () => {
      const block: ThinkingBlock = {
        type: 'tool_use',
        id: 'tool1',
        name: 'search',
      }
      expect(isThinkingBlock(block)).toBe(false)
    })

    it('should not detect tool_result blocks', () => {
      const block: ThinkingBlock = {
        type: 'tool_result',
        tool_use_id: 'tool1',
        content: 'result',
      }
      expect(isThinkingBlock(block)).toBe(false)
    })

    it('should not detect image blocks', () => {
      const block: ThinkingBlock = { type: 'image', source: { type: 'base64' } }
      expect(isThinkingBlock(block)).toBe(false)
    })

    it('should not detect blocks with only text', () => {
      const block: ThinkingBlock = { text: 'Just text' }
      expect(isThinkingBlock(block)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle empty object', () => {
      const block: ThinkingBlock = {}
      expect(isThinkingBlock(block)).toBe(false)
    })

    it('should handle blocks with multiple indicators', () => {
      const block: ThinkingBlock = { type: 'thinking', thinking: 'content' }
      expect(isThinkingBlock(block)).toBe(true)
    })

    it('should not detect numeric thinking field', () => {
      const block = { thinking: 42 } as unknown as ThinkingBlock
      expect(isThinkingBlock(block)).toBe(false)
    })

    it('should not detect null thinking field', () => {
      const block = { thinking: null } as unknown as ThinkingBlock
      expect(isThinkingBlock(block)).toBe(false)
    })

    it('should detect empty string thinking field', () => {
      const block: ThinkingBlock = { thinking: '' }
      expect(isThinkingBlock(block)).toBe(true)
    })

    it('should not detect blocks with type: thought (not a valid type)', () => {
      const block: ThinkingBlock = { type: 'thought' }
      expect(isThinkingBlock(block)).toBe(false)
    })

    it('should not detect blocks with type: reasoning (Anthropic blocks use thinking)', () => {
      const block: ThinkingBlock = { type: 'reasoning' }
      expect(isThinkingBlock(block)).toBe(false)
    })
  })
})
